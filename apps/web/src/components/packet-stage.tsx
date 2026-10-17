import { PACKETS } from "@/lib/game-config";

const players = ["安", "林", "乔", "野", "岑", "禾", "周", "小满"];
const groups = [[0], [1, 2], [3], [4, 5, 6, 7]];

export function PacketStage() {
  return (
    <div className="stage-shell" aria-label="公开站队示意">
      <div className="stage-topline">
        <span className="live-dot">公开站队中</span>
        <span>剩余 12 区块</span>
      </div>
      <div className="stage-packets">
        {PACKETS.map((packet, packetIndex) => (
          <article
            className="mini-packet"
            key={packet.id}
            style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}
          >
            <div className="mini-packet__fold" />
            <p>{packet.name}</p>
            <strong>{packet.amount}</strong>
            <small>MON</small>
            <div className="player-chips">
              {groups[packetIndex].map((playerIndex) => (
                <span key={playerIndex} title={`玩家 ${players[playerIndex]}`}>
                  {players[playerIndex]}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
      <div className="stage-caption">
        <span>8 人已就位</span>
        <span>站队会被看见，最终选择不会。</span>
      </div>
    </div>
  );
}
