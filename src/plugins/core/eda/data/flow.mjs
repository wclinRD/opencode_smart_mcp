/**
 * EDA Cell Flow Stages（from flow.json）
 * EDA_CMD_INDEX 從 CELL_FLOW_STAGES 計算，不可 JSON 化
 */
import CELL_FLOW_STAGES from './flow.json' with { type: 'json' };
export { CELL_FLOW_STAGES };

/** 從 CELL_FLOW_STAGES 計算的命令索引：cmd → { stage, tool, command, desc } */
export const EDA_CMD_INDEX = {};
for (const [stageKey, stage] of Object.entries(CELL_FLOW_STAGES)) {
  for (const [tool, toolInfo] of Object.entries(stage.tools)) {
    for (const cmd of toolInfo.commands) {
      const key = cmd.cmd.toLowerCase();
      EDA_CMD_INDEX[key] = {
        stage: stage.name,
        tool,
        command: cmd.cmd,
        desc: cmd.desc,
      };
    }
  }
}
