export const PACKETS = [
  { id: 0, name: "青禾", amount: "0.01", color: "#38B889", ink: "#062B20" },
  { id: 1, name: "海蓝", amount: "0.02", color: "#4D86F7", ink: "#071D43" },
  { id: 2, name: "藤紫", amount: "0.03", color: "#9A6BE8", ink: "#24103E" },
  { id: 3, name: "鎏金", amount: "0.05", color: "#F1B83B", ink: "#3D2700" },
] as const;

export type PacketId = (typeof PACKETS)[number]["id"];

export const PHASES = [
  { key: "signal", label: "公开站队", note: "让所有人看到你的意图" },
  { key: "commit", label: "秘密锁定", note: "答案变成不可读的承诺" },
  { key: "reveal", label: "同时揭晓", note: "举起手机，颜色即答案" },
  { key: "settle", label: "少数获胜", note: "人数最少者平分红包" },
] as const;
