import type { NearSettings } from '../engine/near';
import { DEV_TOOLS } from './config';

export interface Preset {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  /** Take-profits as multiples of entry and % of the bag. */
  tps: { x: number; pct: number }[];
  /** Stop loss as a multiple of entry (0.7 = −30%), or null. */
  slX: number | null;
  trail: { pct: number; activateX: number | null } | null;
}

export interface Settings {
  paused: boolean;
  dryRun: boolean;
  presets: Preset[];
  defaultPresetId: string;
  autoGuard: { enabled: boolean; includeExisting: boolean };
  gapPolicy: 'sell' | 'ask';
  /** Allow Tippy to bring its selling tab to the front if fomo stalls in the background. */
  focus: { stopLoss: boolean; takeProfit: boolean };
  /** Take-profits skip sells above this price impact (%). Stops sell anyway up to the hard cap. */
  maxImpactTp: number;
  maxImpactStop: number;
  /** Limit buys skip a buy that would move the price more than this (%). */
  maxImpactBuy: number;
  acceptRiskWarnings: boolean;
  notifications: boolean;
  /** "Getting close" heads-ups: how far to a take-profit, how near a stop, how many a day. */
  near: NearSettings;
  telegram: { linkId: string | null; linked: boolean };
  deskConsent: boolean;
  /**
   * Keep the computer from sleeping while any order is on — orders can only fire
   * while it's awake. On by default (it replaced the old opt-in `keepAwake`).
   */
  stayAwake: boolean;
  /** How the window shows and takes levels: market cap ($1M) by default, or a move (2x / −20%). */
  levelUnit: 'mc' | 'move';
  /** Draw Tippy's levels on fomo's chart as dashed lines (drag one to move it). */
  chartLines: boolean;
  /** Offer the trailing stop in Tippy's window (hidden by default; a plan that has one always shows it). */
  showTrailing: boolean;
  onboarded: boolean;
  /** The user said they added fomo.family to the browser's "always keep active" list (Tippy can't check). */
  keepActiveDone: boolean;
  /** The user said they set Chrome to open at login (Tippy can't check). */
  loginItemDone: boolean;
}

export const DEFAULT_PRESETS: Preset[] = [
  {
    id: 'safe',
    name: 'Play it safe',
    emoji: '🛟',
    blurb: 'Double up and walk away. Cut losses at −20%.',
    tps: [{ x: 2, pct: 100 }],
    slX: 0.8,
    trail: null,
  },
  {
    id: 'classic',
    name: 'Classic',
    emoji: '⭐',
    blurb: 'Half at 2x, a quarter at 5x, stop at −30%.',
    tps: [
      { x: 2, pct: 50 },
      { x: 5, pct: 25 },
    ],
    slX: 0.7,
    trail: null,
  },
  {
    id: 'moon',
    name: 'Moon bag',
    emoji: '🌙',
    blurb: 'Take a third at 3x and 10x, trail the rest 25% from the top.',
    tps: [
      { x: 3, pct: 33 },
      { x: 10, pct: 33 },
    ],
    slX: 0.6,
    trail: { pct: 25, activateX: 2 },
  },
];

export const DEFAULT_SETTINGS: Settings = {
  paused: false,
  dryRun: false,
  presets: DEFAULT_PRESETS,
  defaultPresetId: 'classic',
  autoGuard: { enabled: false, includeExisting: false },
  gapPolicy: 'sell',
  focus: { stopLoss: true, takeProfit: false },
  maxImpactTp: 15,
  maxImpactStop: 40,
  maxImpactBuy: 10,
  acceptRiskWarnings: true,
  notifications: false,
  near: { tp: [50, 90], sl: 20, maxPerDay: 5 },
  telegram: { linkId: null, linked: false },
  deskConsent: false,
  stayAwake: true,
  levelUnit: 'mc',
  chartLines: true,
  showTrailing: false,
  onboarded: false,
  keepActiveDone: false,
  loginItemDone: false,
};

export function withDefaults(s: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    autoGuard: { ...DEFAULT_SETTINGS.autoGuard, ...s?.autoGuard },
    focus: { ...DEFAULT_SETTINGS.focus, ...s?.focus },
    telegram: { ...DEFAULT_SETTINGS.telegram, ...s?.telegram },
    near: { ...DEFAULT_SETTINGS.near, ...s?.near },
    presets: s?.presets?.length ? s.presets : DEFAULT_PRESETS,
    dryRun: DEV_TOOLS && !!s?.dryRun,
  };
}
