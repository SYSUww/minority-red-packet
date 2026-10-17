"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DoorOpen } from "lucide-react";
import { CONTRACT_STORAGE_KEY, configuredContractAddress } from "@/lib/injected-wallet";

export function RoomEntry() {
  const router = useRouter();
  const [roomId, setRoomId] = useState("");
  const valid = /^\d+$/.test(roomId.trim()) && BigInt(roomId.trim()) > 0n;

  return (
    <form
      className="room-entry"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) {
          const contract = configuredContractAddress(window.localStorage.getItem(CONTRACT_STORAGE_KEY));
          const fixedDeployment = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim();
          const query = contract && !fixedDeployment ? `?contract=${contract}` : "";
          router.push(`/play/${roomId.trim()}${query}`);
        }
      }}
    >
      <label htmlFor="room-number">已有房间号</label>
      <div>
        <input
          id="room-number"
          inputMode="numeric"
          pattern="[0-9]*"
          value={roomId}
          onChange={(event) => setRoomId(event.target.value.replace(/\D/g, ""))}
          placeholder="例如 12"
        />
        <button type="submit" disabled={!valid}><DoorOpen size={17} />加入房间</button>
      </div>
    </form>
  );
}
