import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from './prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function applySearchExtension() {
  try {
    const sqlPath = path.join(__dirname, '../../prisma/search-extension.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Split into statements, but don't split on semicolons inside $$ ... $$ blocks
    const statements = splitSqlStatements(sql);

    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
    console.log('✅ Full-text search extension applied (tsvector + trigger + index)');
  } catch (err) {
    console.error('❌ Failed to apply search extension:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;

  const lines = sql.split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('--')) continue;

    current += line + '\n';

    const dollarMatches = line.match(/\$\$/g);
    if (dollarMatches) {
      for (let i = 0; i < dollarMatches.length; i++) {
        inDollarQuote = !inDollarQuote;
      }
    }

    if (!inDollarQuote && current.trim().endsWith(';')) {
      const trimmed = current.trim();
      if (trimmed.length > 1) statements.push(trimmed);
      current = '';
    }
  }
  if (current.trim().length) statements.push(current.trim());
  return statements;
}

applySearchExtension();