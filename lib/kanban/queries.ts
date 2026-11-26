import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import {
  board, boardColumn, boardLabel, boardMember, notification, subtask, task,
  taskActivity, taskAssignee, taskAttachment, taskComment, taskLabel, user,
} from "@/db/schema";

/**
 * Boards this person may open: everything for an admin, otherwise only boards
 * they're a member of. This is the visibility boundary — the UI never filters
 * a fuller list client-side.
 */
export async function listBoardsFor(userId: string, role: string | null | undefined) {
  const isAdmin = role === "admin";
  const rows = isAdmin
    ? await db.select({
        id: board.id, name: board.name, description: board.description,
        archived: board.archived, boardRole: sql<string | null>`null`,
      }).from(board).orderBy(asc(board.name))
    : await db.select({
        id: board.id, name: board.name, description: board.description,
        archived: board.archived, boardRole: boardMember.boardRole,
      })
        .from(board)
        .innerJoin(boardMember, eq(boardMember.boardId, board.id))
        .where(eq(boardMember.userId, userId))
        .orderBy(asc(board.name));
  return rows;
}

export type TaskFilters = {
  search?: string;
  assigneeId?: string;
  priority?: string;
  labelId?: string;
  due?: "overdue" | "today" | "week" | "";
  createdById?: string;
};

/**
 * The whole board in a handful of queries rather than per-card lookups:
 * columns, tasks, then one batched query each for assignees, labels and
 * counts. A board with 200 cards would otherwise issue hundreds of queries.
 */
export async function getBoardData(boardId: string, filters: TaskFilters = {}) {
  const columns = await db
    .select()
    .from(boardColumn)
    .where(eq(boardColumn.boardId, boardId))
    .orderBy(asc(boardColumn.position));

  const conditions = [eq(task.boardId, boardId), eq(task.archived, false)];
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(or(sql`${task.title} ilike ${term}`, sql`${task.description} ilike ${term}`)!);
  }
  if (filters.priority) conditions.push(eq(task.priority, filters.priority as "low" | "medium" | "high" | "urgent"));
  if (filters.createdById) conditions.push(eq(task.createdById, filters.createdById));

  const now = new Date();
  if (filters.due === "overdue") {
    conditions.push(sql`${task.dueDate} < ${now} and ${task.completedAt} is null`);
  } else if (filters.due === "today") {
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    conditions.push(sql`${task.dueDate} between ${start} and ${end}`);
  } else if (filters.due === "week") {
    const end = new Date(now); end.setDate(end.getDate() + 7);
    conditions.push(sql`${task.dueDate} between ${now} and ${end}`);
  }

  let tasks = await db
    .select()
    .from(task)
    .where(and(...conditions))
    .orderBy(asc(task.position));

  // Assignee and label filters are applied after the fact because they live in
  // join tables; the task set is already scoped to one board, so this is a
  // small in-memory filter rather than a second round of SQL.
  const taskIds = tasks.map((t) => t.id);
  const [assignees, labels, subtasks, commentCounts, attachmentCounts] = await Promise.all([
    taskIds.length
      ? db.select({ taskId: taskAssignee.taskId, id: user.id, name: user.name, image: user.image })
          .from(taskAssignee).innerJoin(user, eq(user.id, taskAssignee.userId))
          .where(inArray(taskAssignee.taskId, taskIds))
      : [],
    taskIds.length
      ? db.select({ taskId: taskLabel.taskId, id: boardLabel.id, name: boardLabel.name, color: boardLabel.color })
          .from(taskLabel).innerJoin(boardLabel, eq(boardLabel.id, taskLabel.labelId))
          .where(inArray(taskLabel.taskId, taskIds))
      : [],
    taskIds.length
      ? db.select({ taskId: subtask.taskId, done: subtask.done }).from(subtask).where(inArray(subtask.taskId, taskIds))
      : [],
    taskIds.length
      ? db.select({ taskId: taskComment.taskId, n: sql<number>`count(*)::int` })
          .from(taskComment).where(inArray(taskComment.taskId, taskIds)).groupBy(taskComment.taskId)
      : [],
    taskIds.length
      ? db.select({ taskId: taskAttachment.taskId, n: sql<number>`count(*)::int` })
          .from(taskAttachment).where(inArray(taskAttachment.taskId, taskIds)).groupBy(taskAttachment.taskId)
      : [],
  ]);

  if (filters.assigneeId) {
    const allowed = new Set(assignees.filter((a) => a.id === filters.assigneeId).map((a) => a.taskId));
    tasks = tasks.filter((t) => allowed.has(t.id));
  }
  if (filters.labelId) {
    const allowed = new Set(labels.filter((l) => l.id === filters.labelId).map((l) => l.taskId));
    tasks = tasks.filter((t) => allowed.has(t.id));
  }

  const cards = tasks.map((t) => {
    const subs = subtasks.filter((s) => s.taskId === t.id);
    return {
      ...t,
      assignees: assignees.filter((a) => a.taskId === t.id).map(({ id, name, image }) => ({ id, name, image })),
      labels: labels.filter((l) => l.taskId === t.id).map(({ id, name, color }) => ({ id, name, color })),
      subtaskTotal: subs.length,
      subtaskDone: subs.filter((s) => s.done).length,
      commentCount: commentCounts.find((c) => c.taskId === t.id)?.n ?? 0,
      attachmentCount: attachmentCounts.find((c) => c.taskId === t.id)?.n ?? 0,
    };
  });

  const [members, boardLabels, [info]] = await Promise.all([
    db.select({ id: user.id, name: user.name, image: user.image, role: user.role, boardRole: boardMember.boardRole })
      .from(boardMember).innerJoin(user, eq(user.id, boardMember.userId))
      .where(eq(boardMember.boardId, boardId)).orderBy(asc(user.name)),
    db.select().from(boardLabel).where(eq(boardLabel.boardId, boardId)).orderBy(asc(boardLabel.name)),
    db.select().from(board).where(eq(board.id, boardId)).limit(1),
  ]);

  const doneColumnIds = new Set(columns.filter((c) => c.isDone).map((c) => c.id));
  const stats = {
    total: cards.length,
    completed: cards.filter((c) => doneColumnIds.has(c.columnId)).length,
    inProgress: cards.filter((c) => !doneColumnIds.has(c.columnId)).length,
    overdue: cards.filter((c) => c.dueDate && !c.completedAt && new Date(c.dueDate) < now).length,
  };

  // Active (non-done) task count per member — the manager's workload view.
  const workload = members.map((m) => ({
    ...m,
    active: cards.filter((c) => !doneColumnIds.has(c.columnId) && c.assignees.some((a) => a.id === m.id)).length,
    overdue: cards.filter(
      (c) => c.dueDate && !c.completedAt && new Date(c.dueDate) < now && c.assignees.some((a) => a.id === m.id)
    ).length,
  }));

  return { board: info, columns, cards, members, labels: boardLabels, stats, workload };
}

export async function getTaskDetail(taskId: string) {
  const [t] = await db.select().from(task).where(eq(task.id, taskId)).limit(1);
  if (!t) return null;
  const [assignees, labels, subs, comments, attachments, activity] = await Promise.all([
    db.select({ id: user.id, name: user.name, image: user.image })
      .from(taskAssignee).innerJoin(user, eq(user.id, taskAssignee.userId)).where(eq(taskAssignee.taskId, taskId)),
    db.select({ id: boardLabel.id, name: boardLabel.name, color: boardLabel.color })
      .from(taskLabel).innerJoin(boardLabel, eq(boardLabel.id, taskLabel.labelId)).where(eq(taskLabel.taskId, taskId)),
    db.select().from(subtask).where(eq(subtask.taskId, taskId)).orderBy(asc(subtask.position)),
    db.select({
        id: taskComment.id, body: taskComment.body, createdAt: taskComment.createdAt,
        editedAt: taskComment.editedAt, authorId: taskComment.authorId, authorName: user.name,
      })
      .from(taskComment).leftJoin(user, eq(user.id, taskComment.authorId))
      .where(eq(taskComment.taskId, taskId)).orderBy(asc(taskComment.createdAt)),
    db.select({
        id: taskAttachment.id, name: taskAttachment.name, url: taskAttachment.url,
        uploadedById: taskAttachment.uploadedById, createdAt: taskAttachment.createdAt,
      })
      .from(taskAttachment).where(eq(taskAttachment.taskId, taskId)).orderBy(desc(taskAttachment.createdAt)),
    db.select({ id: taskActivity.id, message: taskActivity.message, createdAt: taskActivity.createdAt })
      .from(taskActivity).where(eq(taskActivity.taskId, taskId)).orderBy(desc(taskActivity.createdAt)).limit(50),
  ]);
  return { ...t, assignees, labels, subtasks: subs, comments, attachments, activity };
}

/** Everything assigned to one person across every board they belong to. */
export async function getMyTasks(userId: string) {
  const rows = await db
    .select({
      id: task.id, title: task.title, priority: task.priority, dueDate: task.dueDate,
      completedAt: task.completedAt, boardId: task.boardId, boardName: board.name,
      columnName: boardColumn.name, isDone: boardColumn.isDone,
    })
    .from(taskAssignee)
    .innerJoin(task, eq(task.id, taskAssignee.taskId))
    .innerJoin(board, eq(board.id, task.boardId))
    .innerJoin(boardColumn, eq(boardColumn.id, task.columnId))
    .where(and(eq(taskAssignee.userId, userId), eq(task.archived, false)))
    .orderBy(asc(task.dueDate));

  const now = new Date();
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  return {
    overdue: rows.filter((r) => !r.isDone && r.dueDate && new Date(r.dueDate) < now),
    dueToday: rows.filter((r) => !r.isDone && r.dueDate && new Date(r.dueDate) >= now && new Date(r.dueDate) <= todayEnd),
    upcoming: rows.filter((r) => !r.isDone && (!r.dueDate || new Date(r.dueDate) > todayEnd)),
    completed: rows.filter((r) => r.isDone),
  };
}

export async function getNotifications(userId: string) {
  return db
    .select({
      id: notification.id, message: notification.message, readAt: notification.readAt,
      createdAt: notification.createdAt, taskId: notification.taskId,
    })
    .from(notification)
    .where(eq(notification.userId, userId))
    .orderBy(desc(notification.createdAt))
    .limit(30);
}

/** Candidates for board membership. */
export async function listAssignableUsers() {
  return db.select({ id: user.id, name: user.name, image: user.image, role: user.role })
    .from(user).where(eq(user.banned, false)).orderBy(asc(user.name));
}
