export const PACKETS = [
  { id: 0, name: "青禾", color: "#38B889", ink: "#062B20" },
  { id: 1, name: "海蓝", color: "#4D86F7", ink: "#071D43" },
  { id: 2, name: "藤紫", color: "#9A6BE8", ink: "#24103E" },
  { id: 3, name: "鎏金", color: "#F1B83B", ink: "#3D2700" },
] as const;

export type PacketId = (typeof PACKETS)[number]["id"];

export const PHASES = [
  { key: "signal", label: "站队并投入", note: "同屏确认公开意图与本轮筹码" },
  { key: "commit", label: "秘密锁定", note: "答案变成不可读的承诺" },
  { key: "reveal", label: "同时揭晓", note: "举起手机，颜色即答案" },
  { key: "settle", label: "少数获胜", note: "按赢家投入权重分配" },
] as const;
