const AVATAR_SKINS = ["#f6d0b1", "#ddb08f", "#c88967", "#8f5b43"] as const;
const AVATAR_HAIR = ["#241d2b", "#51362e", "#7b4a2f", "#313b51", "#5d315f"] as const;

export function PlayerAvatar({ id, name, background }: { id: string; name: string; background: string }) {
  const variant = avatarHash(id);
  const skin = AVATAR_SKINS[variant % AVATAR_SKINS.length];
  const hair = AVATAR_HAIR[(variant >>> 2) % AVATAR_HAIR.length];
  const hairStyle = variant % 4;
  const accessory = (variant >>> 4) % 3;

  return (
    <svg className="player-avatar" viewBox="0 0 40 40" role="img" aria-label={`${name}的头像`}>
      <rect width="40" height="40" rx="12" fill={background} />
      <path d="M8 40c.8-7.4 5.2-11.4 12-11.4S31.2 32.6 32 40" fill={hair} opacity=".88" />
      <circle cx="20" cy="19" r="10.2" fill={skin} />
      {hairStyle === 0 && <path d="M10.2 17.4C9.9 9 14.2 5.9 20 6.2c6.8.3 10.4 4.7 9.6 12-2-1-3.1-4.2-3.7-6.5-3.2 3.2-8.1 4.7-15.7 5.7Z" fill={hair} />}
      {hairStyle === 1 && <path d="M9.8 18.7C8.5 10.4 12.9 6 20.2 6c7.6 0 11.2 5.8 9.6 14.6l-3.2-8.3c-4.2 2.1-9.7 3.1-16.8 2.7v3.7Z" fill={hair} />}
      {hairStyle === 2 && <><path d="M10 18.2C9.1 10.7 13.3 6 20.1 6c6.5 0 10.6 4.4 9.8 11.5-3.8-4.3-9.5-6.2-17.1-5.7L10 18.2Z" fill={hair} /><circle cx="28.3" cy="8.8" r="3.3" fill={hair} /></>}
      {hairStyle === 3 && <path d="M9.8 18.8C8.7 11 12.2 6.1 19.5 6c6.8-.1 10.9 4 10.6 11.5-4.6-.1-8.4-2.3-11.5-6.4-2.6 3.1-5.5 5.1-8.8 5.9v1.8Z" fill={hair} />}
      <circle cx="16.3" cy="19.8" r="1.15" fill="#241d2b" />
      <circle cx="23.7" cy="19.8" r="1.15" fill="#241d2b" />
      <path d="M17.2 24c1.8 1.4 3.7 1.4 5.6 0" fill="none" stroke="#9d5e58" strokeLinecap="round" strokeWidth="1.15" />
      {accessory === 0 && <><path d="M12.6 18.8h6.2M21.2 18.8h6.2M18.8 18.8h2.4" stroke="#352b43" strokeWidth="1.1" /><circle cx="15.8" cy="19" r="2.7" fill="none" stroke="#352b43" strokeWidth="1" /><circle cx="24.2" cy="19" r="2.7" fill="none" stroke="#352b43" strokeWidth="1" /></>}
      {accessory === 1 && <circle cx="29" cy="22.3" r="1.15" fill="#fff1a8" stroke="#6f4c18" strokeWidth=".45" />}
      {accessory === 2 && <path d="m12.6 11.2.7 1.4 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2.7-1.4Z" fill="#fff4b8" stroke="#6f4c18" strokeWidth=".35" />}
    </svg>
  );
}

function avatarHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
