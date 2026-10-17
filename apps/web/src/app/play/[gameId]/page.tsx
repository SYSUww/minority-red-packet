import { PlayerGame } from "@/components/player-game";

export default async function PlayerPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <PlayerGame gameId={gameId} />;
}
