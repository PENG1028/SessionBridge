// ─── Unit tests: InstanceManager ──────────────────────────

import { describe, it, expect } from 'vitest';
import { InstanceManager } from '../../src/instance-manager';

describe('InstanceManager', () => {
  it('starts with no instances', () => {
    const mgr = new InstanceManager();
    expect(mgr.list()).toHaveLength(0);
    expect(mgr.count).toBe(0);
    expect(mgr.activeId).toBeNull();
    expect(mgr.getActive()).toBeUndefined();
  });

  it('creates an instance with generated id and label', () => {
    const mgr = new InstanceManager();
    const inst = mgr.create('/some/project');

    expect(inst.id).toBeTruthy();
    expect(inst.id).toMatch(/^inst_\d+_/);
    expect(inst.dir).toBe('/some/project');
    expect(inst.label).toBe('project');
    expect(inst.status).toBe('starting');
    expect(inst.createdAt).toBeGreaterThan(0);
    expect(mgr.count).toBe(1);
  });

  it('creates instances with unique ids', () => {
    const mgr = new InstanceManager();
    const a = mgr.create('/a');
    const b = mgr.create('/b');
    expect(a.id).not.toBe(b.id);
  });

  it('creates an instance with custom label', () => {
    const mgr = new InstanceManager();
    const inst = mgr.create('/some/project', 'My Label');
    expect(inst.label).toBe('My Label');
  });

  it('gets instance by id', () => {
    const mgr = new InstanceManager();
    const created = mgr.create('/test');
    const found = mgr.get(created.id);
    expect(found).toBe(created);
  });

  it('returns undefined for non-existent id', () => {
    const mgr = new InstanceManager();
    expect(mgr.get('nonexistent')).toBeUndefined();
  });

  it('lists all instances', () => {
    const mgr = new InstanceManager();
    mgr.create('/a');
    mgr.create('/b');
    mgr.create('/c');
    expect(mgr.list()).toHaveLength(3);
  });

  it('kills (removes) an instance and returns true', () => {
    const mgr = new InstanceManager();
    const inst = mgr.create('/test');
    expect(mgr.count).toBe(1);

    const result = mgr.kill(inst.id);
    expect(result).toBe(true);
    expect(mgr.get(inst.id)).toBeUndefined();
    expect(mgr.count).toBe(0);
  });

  it('returns false when killing non-existent instance', () => {
    const mgr = new InstanceManager();
    expect(mgr.kill('nonexistent')).toBe(false);
  });

  it('clears active id when active instance is killed', () => {
    const mgr = new InstanceManager();
    const a = mgr.create('/a');
    const b = mgr.create('/b');
    mgr.setActive(a.id);
    expect(mgr.activeId).toBe(a.id);

    mgr.kill(a.id);
    expect(mgr.activeId).toBeNull();
  });

  it('does not clear active id when non-active instance is killed', () => {
    const mgr = new InstanceManager();
    const a = mgr.create('/a');
    const b = mgr.create('/b');
    mgr.setActive(a.id);

    mgr.kill(b.id);
    expect(mgr.activeId).toBe(a.id);
  });

  describe('setActive / getActive', () => {
    it('sets and gets active instance', () => {
      const mgr = new InstanceManager();
      const inst = mgr.create('/test');
      mgr.setActive(inst.id);
      expect(mgr.activeId).toBe(inst.id);
      expect(mgr.getActive()).toBe(inst);
    });

    it('setActive with null clears active', () => {
      const mgr = new InstanceManager();
      const inst = mgr.create('/test');
      mgr.setActive(inst.id);
      mgr.setActive(null);
      expect(mgr.activeId).toBeNull();
    });

    it('does not change active when set with non-existent id', () => {
      const mgr = new InstanceManager();
      mgr.setActive('nonexistent');
      expect(mgr.activeId).toBeNull();

      const inst = mgr.create('/test');
      mgr.setActive(inst.id);
      mgr.setActive('nonexistent');
      expect(mgr.activeId).toBe(inst.id);
    });
  });

  describe('stopAll', () => {
    it('clears all instances and active id', () => {
      const mgr = new InstanceManager();
      mgr.create('/a');
      mgr.create('/b');
      const c = mgr.create('/c');
      mgr.setActive(c.id);

      expect(mgr.count).toBe(3);
      mgr.stopAll();
      expect(mgr.count).toBe(0);
      expect(mgr.list()).toHaveLength(0);
      expect(mgr.activeId).toBeNull();
    });
  });

  describe('toJSON', () => {
    it('serializes instances without process/buffer internals', () => {
      const mgr = new InstanceManager();
      mgr.create('/test/dir', 'test-label');
      const json = mgr.toJSON();
      expect(json).toHaveLength(1);

      const entry = json[0];
      expect(entry.id).toBeTruthy();
      expect(entry.dir).toBe('/test/dir');
      expect(entry.label).toBe('test-label');
      expect(entry.status).toBe('starting');
      expect(entry.model).toBeNull();
      expect(typeof entry.blockCount).toBe('number');
      expect(typeof entry.outputSize).toBe('number');
      expect(typeof entry.checkpointCount).toBe('number');
      expect(typeof entry.createdAt).toBe('number');

      // Should NOT expose internal fields
      expect((entry as any).process).toBeUndefined();
      expect((entry as any).blockBuffer).toBeUndefined();
      expect((entry as any).outputBuffer).toBeUndefined();
      expect((entry as any).pendingQueue).toBeUndefined();
    });

    it('returns empty array when no instances', () => {
      const mgr = new InstanceManager();
      expect(mgr.toJSON()).toEqual([]);
    });
  });
});
