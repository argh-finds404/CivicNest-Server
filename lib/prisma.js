/**
 * lib/prisma.js
 * Shared Prisma client. Uses DATABASE_URL when set, otherwise the existing
 * MONGODB_URI / DB_USER+DB_PASS settings. Prisma needs the database name in
 * the URL, so "communityDB" is filled in when the URL has none.
 */
const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

const DB_NAME = "communityDB";

function resolveDatabaseUrl() {
  const raw =
    process.env.DATABASE_URL ||
    process.env.MONGODB_URI ||
    `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;

  // mongodb[+srv]://user:pass@host[,host]/<db>?options
  const match = raw.match(/^(mongodb(?:\+srv)?:\/\/[^/?]+)(\/[^?]*)?(\?.*)?$/);
  if (!match) return raw;
  const [, base, path, query = ""] = match;
  const db = path && path.length > 1 ? path : `/${DB_NAME}`;
  return `${base}${db}${query}`;
}

const prisma = global.__civicPrisma || new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });
if (process.env.NODE_ENV !== "production") global.__civicPrisma = prisma;

module.exports = { prisma, resolveDatabaseUrl };
