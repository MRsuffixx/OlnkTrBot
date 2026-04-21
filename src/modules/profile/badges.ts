export interface Badge {
  id: string;
  nameKey: string;
  descriptionKey: string;
  icon: string; // Emoji
}

export const BADGES: Record<string, Badge> = {
  first_command: {
    id: 'first_command',
    nameKey: 'badges:first_command.name',
    descriptionKey: 'badges:first_command.description',
    icon: '🎯',
  },
  level_5: {
    id: 'level_5',
    nameKey: 'badges:level_5.name',
    descriptionKey: 'badges:level_5.description',
    icon: '⭐',
  },
  level_10: {
    id: 'level_10',
    nameKey: 'badges:level_10.name',
    descriptionKey: 'badges:level_10.description',
    icon: '🌟',
  },
  level_25: {
    id: 'level_25',
    nameKey: 'badges:level_25.name',
    descriptionKey: 'badges:level_25.description',
    icon: '🏆',
  },
  early_adopter: {
    id: 'early_adopter',
    nameKey: 'badges:early_adopter.name',
    descriptionKey: 'badges:early_adopter.description',
    icon: '🚀',
  },
  server_veteran: {
    id: 'server_veteran',
    nameKey: 'badges:server_veteran.name',
    descriptionKey: 'badges:server_veteran.description',
    icon: '🛡️',
  },
  command_100: {
    id: 'command_100',
    nameKey: 'badges:command_100.name',
    descriptionKey: 'badges:command_100.description',
    icon: '💯',
  },
  command_1000: {
    id: 'command_1000',
    nameKey: 'badges:command_1000.name',
    descriptionKey: 'badges:command_1000.description',
    icon: '👑',
  },
  // Add more badges as needed
};

export function getBadge(id: string): Badge | undefined {
  return BADGES[id];
}

export function getAllBadges(): Badge[] {
  return Object.values(BADGES);
}

export function getBadgeIds(): string[] {
  return Object.keys(BADGES);
}

export function getBadgesByIds(ids: string[]): Badge[] {
  return ids
    .map((id) => BADGES[id])
    .filter((badge): badge is Badge => badge !== undefined);
}