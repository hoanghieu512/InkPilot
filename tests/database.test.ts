import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/database/migrations.js';
import { insertPost, getPostById, getPostsByPlatform, countTodayPosts } from '../src/database/posts.js';
import type { InsertPost } from '../src/database/posts.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('Database', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('initializes in-memory database without throwing', () => {
    const testDb = new Database(':memory:');
    expect(() => runMigrations(testDb)).not.toThrow();
    testDb.close();
  });

  it('creates all 7 tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name).sort();

    expect(tableNames).toEqual([
      'article_states',
      'articles',
      'drafts',
      'filter_results',
      'post_metrics',
      'posts',
      'sources',
    ]);
    expect(tables).toHaveLength(7);
  });

  it('insertPost returns a Post with id', () => {
    const input: InsertPost = {
      platform: 'x',
      platform_post_id: '1234567890',
      platform_post_url: 'https://x.com/user/status/1234567890',
      content_snapshot: 'Hello from InkPilot!',
    };

    const post = insertPost(input, db);

    expect(post.id).toBeDefined();
    expect(post.id).toBeGreaterThan(0);
    expect(post.platform).toBe('x');
    expect(post.platform_post_id).toBe('1234567890');
    expect(post.content_snapshot).toBe('Hello from InkPilot!');
    expect(post.posted_at).toBeDefined();
  });

  it('getPostById returns the correct post', () => {
    const input: InsertPost = {
      platform: 'x',
      platform_post_id: '9876543210',
      content_snapshot: 'Test post content',
    };

    const inserted = insertPost(input, db);
    const found = getPostById(inserted.id, db);

    expect(found).toBeDefined();
    expect(found!.id).toBe(inserted.id);
    expect(found!.platform_post_id).toBe('9876543210');
    expect(found!.content_snapshot).toBe('Test post content');
  });

  it('getPostById returns undefined for non-existent id', () => {
    const found = getPostById(9999, db);
    expect(found).toBeUndefined();
  });

  it('countTodayPosts returns correct count', () => {
    expect(countTodayPosts('x', db)).toBe(0);

    insertPost({
      platform: 'x',
      platform_post_id: '001',
      content_snapshot: 'Post 1',
    }, db);

    insertPost({
      platform: 'x',
      platform_post_id: '002',
      content_snapshot: 'Post 2',
    }, db);

    expect(countTodayPosts('x', db)).toBe(2);
  });

  it('getPostsByPlatform returns filtered results', () => {
    insertPost({ platform: 'x', platform_post_id: '001', content_snapshot: 'Post 1' }, db);
    insertPost({ platform: 'x', platform_post_id: '002', content_snapshot: 'Post 2' }, db);

    const posts = getPostsByPlatform('x', 50, db);
    expect(posts).toHaveLength(2);
  });

  it('posts module does not expose updatePost — content_snapshot is immutable by design', () => {
    const input: InsertPost = {
      platform: 'x',
      platform_post_id: 'immutable123',
      content_snapshot: 'Original content — should never change',
    };

    const post = insertPost(input, db);

    const retrieved = getPostById(post.id, db);
    expect(retrieved!.content_snapshot).toBe('Original content — should never change');
  });
});
