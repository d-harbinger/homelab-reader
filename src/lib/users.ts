import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const MIN_PASSWORD_LENGTH = 8;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,32}$/;

export type Role = "admin" | "reader";

export interface PublicUser {
  id: string;
  username: string;
  role: string;
  createdAt: Date;
}

// Thrown for any user-facing validation problem (duplicate name, weak
// password, malformed username). Callers map this to a 400/409.
export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

export async function userCount(): Promise<number> {
  return prisma.user.count();
}

function toPublic(u: {
  id: string;
  username: string;
  role: string;
  createdAt: Date;
}): PublicUser {
  return { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt };
}

export async function listUsers(): Promise<PublicUser[]> {
  const rows = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toPublic);
}

function validate(username: string, password: string) {
  if (!USERNAME_RE.test(username)) {
    throw new UserInputError(
      "Username must be 2–32 characters: letters, numbers, dot, dash, underscore.",
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserInputError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
}

export async function createUser(input: {
  username: string;
  password: string;
  role: Role;
}): Promise<PublicUser> {
  const username = input.username.trim();
  validate(username, input.password);

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw new UserInputError("That username is already taken.");

  const passwordHash = await bcrypt.hash(input.password, 12);
  const row = await prisma.user.create({
    data: { username, passwordHash, role: input.role },
  });
  return toPublic(row);
}

export async function setPassword(
  userId: string,
  password: string,
): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserInputError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

export async function deleteUser(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } });
}
