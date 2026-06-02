'use client';

// ─── useToolTracking ──────────────────────────────────────────────
// Manages tool activity tracking: phase, currentActivity, tasks, logs.
// Extracted from app-shell.tsx / page.tsx.

import { useState, useCallback, useEffect } from 'react';
import type { TaskInfo, ToolActivity, Phase } from '../../lib/session-types';

export function useToolTracking(
  sendCommand: (name: string) => void,
) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [currentActivity, setCurrentActivity] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>(['[$] session-bridge connected']);
  const [activeTasks, setActiveTasks] = useState<Map<string, TaskInfo>>(new Map());
  const [toolActivities, setToolActivities] = useState<Map<string, ToolActivity>>(new Map());
  const [expandedToolOutputs, setExpandedToolOutputs] = useState<Set<string>>(new Set());
  const [taskTimer, setTaskTimer] = useState(0);

  // Timer to refresh task durations every 5s
  useEffect(() => {
    if (activeTasks.size === 0 && !phase) return;
    const timer = setInterval(() => setTaskTimer(t => t + 1), 5000);
    return () => clearInterval(timer);
  }, [activeTasks.size, phase]);

  const addLog = useCallback((msg: string) => setLogs(prev => [...prev, msg]), []);

  const handleInterrupt = useCallback(() => {
    sendCommand('interrupt');
    addLog('[System] ⏹ Interrupting Claude...');
    setPhase('idle');
    setCurrentActivity('Interrupted');
  }, [sendCommand, addLog]);

  return {
    phase, setPhase,
    currentActivity, setCurrentActivity,
    logs, setLogs, addLog,
    activeTasks, setActiveTasks,
    toolActivities, setToolActivities,
    expandedToolOutputs, setExpandedToolOutputs,
    taskTimer,
    handleInterrupt,
  };
}
