export function discordAvatarUrl(
  userId: string,
  avatar?: string | null,
  discriminator?: string | null
): string {
  if (avatar) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=128`;
  }
  if (discriminator && discriminator !== '0') {
    return `https://cdn.discordapp.com/embed/avatars/${Number(discriminator) % 5}.png`;
  }
  try {
    const idx = Number((BigInt(userId) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  } catch {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

export function displayNameFromDiscord(user: {
  id: string;
  username?: string;
  global_name?: string | null;
  discriminator?: string;
}): string {
  if (user.global_name && user.global_name.trim()) return user.global_name.trim();
  if (user.username && user.username.trim()) {
    if (user.discriminator && user.discriminator !== '0') {
      return `${user.username}#${user.discriminator}`;
    }
    return user.username.trim();
  }
  return 'Discord Player';
}
