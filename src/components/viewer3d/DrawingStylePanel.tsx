'use client';

import React from 'react';
import { Pipette } from 'lucide-react';

export const STROKE_COLORS = [
  { value: '#ef4444', name: 'Red' },
  { value: '#f97316', name: 'Orange' },
  { value: '#facc15', name: 'Yellow' },
  { value: '#22c55e', name: 'Green' },
  { value: '#06b6d4', name: 'Cyan' },
  { value: '#3b82f6', name: 'Blue' },
  { value: '#8b5cf6', name: 'Purple' },
  { value: '#ec4899', name: 'Pink' },
  { value: '#ffffff', name: 'White' },
  { value: '#18181b', name: 'Black' },
];

export const STROKE_WIDTH_PRESETS = [
  { value: 2, name: 'Fine' },
  { value: 4, name: 'Medium' },
  { value: 7, name: 'Bold' },
  { value: 11, name: 'Marker' },
];

export const MIN_STROKE_WIDTH = 1;
export const MAX_STROKE_WIDTH = 16;

interface DrawingStylePanelProps {
  color: string;
  width: number;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
}

/** Floating style bar for markup tools: stroke color and thickness. */
export function DrawingStylePanel({ color, width, onColorChange, onWidthChange }: DrawingStylePanelProps) {
  const isCustomColor = !STROKE_COLORS.some((c) => c.value === color.toLowerCase());

  return (
    <div
      role="toolbar"
      aria-label="Stroke style"
      className="flex items-center gap-3 px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl shadow-xl backdrop-blur text-zinc-300"
    >
      {/* Color */}
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Stroke color">
        {STROKE_COLORS.map((c) => {
          const selected = color.toLowerCase() === c.value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={c.name}
              title={c.name}
              onClick={() => onColorChange(c.value)}
              className={`w-5 h-5 rounded-full border border-white/20 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                selected ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110' : 'hover:scale-110'
              }`}
              style={{ backgroundColor: c.value }}
            />
          );
        })}
        <label
          title="Custom color"
          className={`relative w-5 h-5 rounded-full flex items-center justify-center cursor-pointer border border-white/20 focus-within:ring-2 focus-within:ring-blue-400 ${
            isCustomColor ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : ''
          }`}
          style={isCustomColor ? { backgroundColor: color } : undefined}
        >
          {!isCustomColor && <Pipette className="w-3 h-3 text-zinc-300" />}
          <input
            type="color"
            aria-label="Custom stroke color"
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
      </div>

      <div className="h-6 w-px bg-zinc-700" />

      {/* Thickness */}
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Stroke thickness">
        {STROKE_WIDTH_PRESETS.map((p) => {
          const selected = width === p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${p.name} (${p.value}px)`}
              title={`${p.name} (${p.value}px)`}
              onClick={() => onWidthChange(p.value)}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                selected ? 'bg-blue-600' : 'hover:bg-zinc-800'
              }`}
            >
              <span
                className="rounded-full"
                style={{ width: Math.max(3, p.value * 1.4), height: Math.max(3, p.value * 1.4), backgroundColor: color }}
              />
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={MIN_STROKE_WIDTH}
          max={MAX_STROKE_WIDTH}
          step={1}
          value={width}
          onChange={(e) => onWidthChange(Number(e.target.value))}
          aria-label="Stroke thickness in pixels"
          title="Thickness — [ / ] to adjust"
          className="w-24 accent-blue-500"
        />
        <span className="text-[11px] tabular-nums text-zinc-400 w-8">{width}px</span>
      </div>
    </div>
  );
}
