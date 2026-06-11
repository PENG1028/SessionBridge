'use client';

import { useState, useCallback } from 'react';
import { PROVIDER_PRESETS, getPresetById, type ProviderPreset } from '../config/provider-presets';

// ─── Types ──────────────────────────────────────────

export interface ProviderConfig {
  id: string;
  label: string;
  provider: 'anthropic' | 'openai';
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  category?: string;
}

// ─── Default config ──

function presetToConfig(preset: ProviderPreset): ProviderConfig {
  return {
    id: preset.id,
    label: preset.label,
    provider: preset.provider,
    apiKey: '',
    baseUrl: preset.baseUrl,
    model: preset.model,
    systemPrompt: '',
    category: preset.category,
  };
}

const DEFAULT_CONFIG: ProviderConfig = presetToConfig(PROVIDER_PRESETS[0]);

// ─── Hook ────────────────────────────────────────────
// Config lives in React state only — no localStorage.
// Presets come from config/provider-presets.ts (ported from CC-Switch).

export function useProviderConfig() {
  const [config, setConfigState] = useState<ProviderConfig>(DEFAULT_CONFIG);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastApplied, setLastApplied] = useState<string | null>(null);

  const setById = useCallback((presetId: string) => {
    const preset = getPresetById(presetId);
    if (preset) {
      setConfigState(prev => ({
        ...presetToConfig(preset),
        apiKey: prev.apiKey, // preserve existing API key when switching presets
      }));
      setIsDirty(true);
    }
  }, []);

  const setApiKey = useCallback((key: string) => {
    setConfigState(prev => ({ ...prev, apiKey: key }));
    setIsDirty(true);
  }, []);

  const setModel = useCallback((model: string) => {
    setConfigState(prev => ({ ...prev, model }));
    setIsDirty(true);
  }, []);

  const setBaseUrl = useCallback((url: string) => {
    setConfigState(prev => ({ ...prev, baseUrl: url }));
    setIsDirty(true);
  }, []);

  const setSystemPrompt = useCallback((prompt: string) => {
    setConfigState(prev => ({ ...prev, systemPrompt: prompt }));
    setIsDirty(true);
  }, []);

  const markApplied = useCallback(() => {
    setIsDirty(false);
    setLastApplied(new Date().toLocaleTimeString());
  }, []);

  return {
    config,
    showApiKey,
    setShowApiKey,
    isDirty,
    lastApplied,
    setById,
    setApiKey,
    setModel,
    setBaseUrl,
    setSystemPrompt,
    markApplied,
  };
}
