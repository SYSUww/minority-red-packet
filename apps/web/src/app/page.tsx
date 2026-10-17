import Link from "next/link";
import { ArrowRight, Eye, FlaskConical, LockKeyhole, ScanLine, ShieldCheck } from "lucide-react";
import { PacketStage } from "@/components/packet-stage";
import { RoomEntry } from "@/components/room-entry";
import { SiteHeader } from "@/components/site-header";
import { PHASES } from "@/lib/game-config";

export default function HomePage() {
  return (
    <main className="site-page">
      <SiteHeader />

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span>现场多人博弈</span> · 4—8 人</p>
          <h1>
            跟大家站在一起，
            <em>然后悄悄离开。</em>
          </h1>
          <p className="hero-intro">
            先公开站队，再秘密选择。最终人数最少的红包获胜；赢家按各自投入权重分配败者资金，人数相同时按固定优先级决胜。
          </p>
          <RoomEntry />
          <div className="hero-actions">
            <Link className="button button-primary" href="/host">
              创建或查看房间 <ArrowRight size={18} />
            </Link>
            <Link className="button button-ghost" href="/play/demo">
              <ScanLine size={18} /> 体验玩家端
            </Link>
            <Link className="button button-ghost" href="/test">
              <FlaskConical size={18} /> 本地多人测试
            </Link>
          </div>
          <div className="trust-line">
            <ShieldCheck size={17} />
            <span>玩家付 stake 进入奖池，选择不可偷看，奖金按合约结果领取。</span>
          </div>
        </div>
        <div className="hero-stage">
          <PacketStage />
          <p className="stage-footnote">公开意图不是答案，而是给全场的一条线索。</p>
        </div>
      </section>

      <section className="mechanic" aria-labelledby="mechanic-title">
        <div className="section-heading">
          <p className="eyebrow">一轮 · 四幕</p>
          <h2 id="mechanic-title">不是比手快，是猜你会怎么猜。</h2>
        </div>
        <ol className="phase-list">
          {PHASES.map((phase, index) => (
            <li key={phase.key}>
              <span className="phase-index">0{index + 1}</span>
              <div>
                <h3>{phase.label}</h3>
                <p>{phase.note}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="proof-strip">
        <div>
          <Eye size={22} />
          <p><strong>公开阶段</strong><span>所有人的站队都看得见</span></p>
        </div>
        <div>
          <LockKeyhole size={22} />
          <p><strong>秘密阶段</strong><span>链上只保存不可逆哈希</span></p>
        </div>
        <div>
          <ShieldCheck size={22} />
          <p><strong>结算阶段</strong><span>少数派规则由合约执行</span></p>
        </div>
      </section>

      <footer className="site-footer">
        <span>少数派红包</span>
        <p>普通链能证明，Monad 让证明快到不会打断现场。</p>
      </footer>
    </main>
  );
}
