import { describe, expect, it } from "vitest";
import type { FlowTemplateV1 } from "../shared/types";
import { getConditionNodeView, getDelayNodeView } from "./node-adapters";

const template: FlowTemplateV1 = {
  format: "botcake-flow-template",
  version: 1,
  meta: { id: "node-test", name: "节点测试", createdAt: "2026-08-17T00:00:00.000Z" },
  flow: {
    name: "节点测试",
    entryBlockKey: "condition",
    post: { blocks: [
      {
        key: "condition",
        title: "Condition #8",
        type: "condition",
        cards: [{
          key: "branch-1",
          type: "and",
          condition: [{
            begin_hour: 7, begin_min: 1, end_hour: 14, end_min: 0,
            filter_type: "ranger", label: "datetime", title: "Current Time",
            type: "current_time", type_compare: "daily", week_days: [1, 2, 3, 4, 5, 6, 7],
          }],
          gotos: { block_key: "delay", block_type: "message", type: "blocks" },
        }],
        defaultGotos: { block_key: "fallback", block_type: "message", type: "blocks" },
      },
      {
        key: "delay",
        title: "Smart Delay #11",
        type: "smart_delay",
        cards: [],
        config: { delayType: "duration", delayUnits: "minutes", delayValue: 1, sendingTimeEnd: 22, sendingTimeStart: 8, useTimeWindow: false },
        defaultGotos: { block_key: "finish", block_type: "message", type: "blocks" },
      },
    ] },
  },
  inputs: [],
  dependencies: { botFields: [], media: [], unsupported: [] },
};

describe("Botcake node adapters", () => {
  it("reads current-time condition branches and their targets", () => {
    expect(getConditionNodeView(template, 0)).toEqual({
      branches: [expect.objectContaining({
        index: 0,
        operator: "and",
        targetBlockKey: "delay",
        rules: [expect.objectContaining({ type: "current_time", beginHour: 7, beginMinute: 1, endHour: 14, endMinute: 0, weekDays: [1, 2, 3, 4, 5, 6, 7] })],
      })],
      defaultTargetBlockKey: "fallback",
    });
  });

  it("reads duration delay configuration and next target", () => {
    expect(getDelayNodeView(template, 1)).toEqual(expect.objectContaining({
      delayType: "duration",
      delayUnits: "minutes",
      delayValue: 1,
      useTimeWindow: false,
      sendingTimeStart: 8,
      sendingTimeEnd: 22,
      targetBlockKey: "finish",
    }));
  });
});
