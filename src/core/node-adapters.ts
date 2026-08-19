import type { FlowTemplateV1 } from "../shared/types";
import { getBlocks } from "./template-graph";

type JsonRecord = Record<string, unknown>;

export type ConditionRuleView = {
  path: string;
  type: string;
  title: string;
  label: string;
  beginHour?: number;
  beginMinute?: number;
  endHour?: number;
  endMinute?: number;
  weekDays: number[];
  values: Array<{ key: string; value: string | number | boolean }>;
};

export type ConditionBranchView = {
  index: number;
  path: string;
  operator: string;
  targetBlockKey: string;
  rules: ConditionRuleView[];
};

export type ConditionNodeView = {
  branches: ConditionBranchView[];
  defaultTargetBlockKey: string;
};

export type DelayNodeView = {
  path: string;
  delayType: string;
  delayUnits: string;
  delayValue: number;
  useTimeWindow: boolean;
  sendingTimeStart: number;
  sendingTimeEnd: number;
  targetBlockKey: string;
};

const CONDITION_TECHNICAL_KEYS = new Set([
  "type", "title", "label", "begin_hour", "begin_min", "end_hour", "end_min",
  "week_days", "start_date", "end_date",
]);

export function getConditionNodeView(template: FlowTemplateV1, blockIndex: number): ConditionNodeView | undefined {
  const block = getBlocks(template)[blockIndex];
  if (!block || stringValue(block.type) !== "condition") return undefined;
  const cards = Array.isArray(block.cards) ? block.cards : [];
  return {
    branches: cards.map((card, index) => {
      const branch = recordValue(card);
      const rules = Array.isArray(branch.condition) ? branch.condition : [];
      return {
        index,
        path: `$.blocks[${blockIndex}].cards[${index}]`,
        operator: stringValue(branch.type) || "and",
        targetBlockKey: stringValue(recordValue(branch.gotos).block_key),
        rules: rules.map((rule, ruleIndex) => conditionRuleView(rule, `$.blocks[${blockIndex}].cards[${index}].condition[${ruleIndex}]`)),
      };
    }),
    defaultTargetBlockKey: stringValue(recordValue(block.defaultGotos).block_key),
  };
}

export function getDelayNodeView(template: FlowTemplateV1, blockIndex: number): DelayNodeView | undefined {
  const block = getBlocks(template)[blockIndex];
  if (!block || !["smart_delay", "delay"].includes(stringValue(block.type))) return undefined;
  const config = recordValue(block.config);
  return {
    path: `$.blocks[${blockIndex}].config`,
    delayType: stringValue(config.delayType) || "duration",
    delayUnits: stringValue(config.delayUnits) || "minutes",
    delayValue: numberValue(config.delayValue, 1),
    useTimeWindow: Boolean(config.useTimeWindow),
    sendingTimeStart: numberValue(config.sendingTimeStart, 8),
    sendingTimeEnd: numberValue(config.sendingTimeEnd, 22),
    targetBlockKey: stringValue(recordValue(block.defaultGotos).block_key),
  };
}

function conditionRuleView(value: unknown, path: string): ConditionRuleView {
  const rule = recordValue(value);
  return {
    path,
    type: stringValue(rule.type) || "unknown",
    title: stringValue(rule.title) || stringValue(rule.type) || "未识别条件",
    label: stringValue(rule.label),
    beginHour: optionalNumber(rule.begin_hour),
    beginMinute: optionalNumber(rule.begin_min),
    endHour: optionalNumber(rule.end_hour),
    endMinute: optionalNumber(rule.end_min),
    weekDays: Array.isArray(rule.week_days) ? rule.week_days.filter((item): item is number => typeof item === "number") : [],
    values: Object.entries(rule).flatMap(([key, item]) => {
      if (CONDITION_TECHNICAL_KEYS.has(key) || !["string", "number", "boolean"].includes(typeof item)) return [];
      return [{ key, value: item as string | number | boolean }];
    }),
  };
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  return optionalNumber(value) ?? fallback;
}
