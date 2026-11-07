/**
 * ╔══════════════════════════════════════════════════════════╗
 *   GEM BATTLE — GAME CONFIG
 *   Редактируй этот файл для балансировки игры
 * ╚══════════════════════════════════════════════════════════╝
 */
window.GAME_CONFIG = {

  /* ── BOARD ─────────────────────────────────────── */
  BOARD_SIZE: 6,

  /* ── TIMING (ms) ───────────────────────────────── */
  AI_DELAY_MS:      1000,
  GEM_POP_MS:        420,
  GEM_FALL_MS:       400,
  STAGGER_MS:        460,
  CASCADE_PAUSE_MS:  600,
  FLOAT_TEXT_MS:    2800,
  SHOP_EVERY:         10,

  /* ── PER-GEM EFFECT VALUES ─────────────────────── */
  EFFECTS: {
    armorPerGem:      5,   
    manaPerGem:      13,
    healPerGem:       9,
    healScale:       0.5,
    armorDecayPerTurn: 2,
  },

  /* ── BASE STATS ─────────────────────────────────── */
  BASE_STATS: {
    maxHp:       200,
    maxMana:     100,
    damage:       12,
    critChance:    0,
    critPower:   1.5,
    dodgeChance:   0,
    blockChance:   0,
    blockPower:  0.30,
    regen:         0,
    baseArmor:     0,
  },

  /* ── CLASSES ────────────────────────────────────── */
  CLASSES: {

    vampire: {
      name: 'Вампир', portrait: 'assets/classes/vampire.png', color: '#ff3030',
      desc: 'Живёт за счёт чужой крови. Восстанавливает HP с каждой атаки, уклоняется и регенерирует.',
      stats:    { maxHp: 270, damage: 14, maxMana: 100 },
      passives: ['vampAttackHeal', 'vampDodge', 'vampRegen'],
      actives:  ['vampirism', 'lifeSwap'],
    },

    paladin: {
      name: 'Паладин', portrait: 'assets/classes/palladin.png', color: '#d0a020',
      desc: 'Священный свет усиливает лечение. Излишек исцеления обращается в урон по врагу.',
      stats:    { maxHp: 320, damage: 12, maxMana: 120 },
      passives: ['holyHeal', 'holyOverheal'],
      actives:  ['holyLight', 'divineStun'],
    },

    knight: {
      name: 'Рыцарь', portrait: 'assets/classes/knight.png', color: '#60a8e0',
      desc: 'Непробиваемый воин. Превращает урон в броню и контратакует атакующих.',
      stats:    { maxHp: 390, damage: 14, maxMana: 80 },
      passives: ['ironWill', 'counterBlock', 'lastStand'],
      actives:  ['guardedStrike', 'shieldBash'],
    },

    mage: {
      name: 'Маг', portrait: 'assets/classes/mage.png', color: '#c060ff',
      desc: 'Повелитель рун. Двойная мана, магический щит и три вида взрыва гемов.',
      stats:    { maxHp: 260, damage: 16, maxMana: 140 },
      passives: ['arcaneChanneling', 'manaOverflow'],
      actives:  ['manaShield', 'gemExplosion', 'armageddon'],
    },

    warlock: {
      name: 'Чернокнижник', portrait: 'assets/classes/warlock.png', color: '#40e0b0',
      desc: 'Повелитель тёмной магии. Боль питает его силу — каждый удар наполняет ману.',
      stats:    { maxHp: 280, damage: 13, maxMana: 110 },
      passives: ['painFueled'],
      actives:  ['curse', 'damageReflect', 'soulDrain'],
    },

    deathKnight: {
      name: 'Рыцарь Смерти', portrait: 'assets/classes/death-kniight.png', color: '#909090',
      desc: 'Чем ниже HP — тем сильнее защита. Руны атаки несут Чуму. Может воскреснуть.',
      stats:    { maxHp: 313, damage: 13, maxMana: 90 },
      passives: ['deathShroud', 'plagueMark', 'undying'],
      actives:  ['graveTouch'],
    },

    berserker: {
      name: 'Берсерк', portrait: 'assets/classes/berserk.png', color: '#ff8800',
      desc: 'Ярость растёт с потерей крови. Каждые 2% утраченного HP дают +1 к урону. Руны атаки имеют шанс крита.',
      stats:    { maxHp: 250, damage: 18, maxMana: 80 },
      passives: ['rage', 'berserkerCrit'],
      actives:  ['burnSwords'],
    },

  },

  /* ── PASSIVES ───────────────────────────────────── */
  PASSIVES: {

    // ── Берсерк ──
    rage: {
      name: 'Ярость', icon: '🔥',
      desc: 'Каждые 2% утраченного HP дают +1 к урону',
      dmgPerTwoPercent: 1,
    },
    berserkerCrit: {
      name: 'Критический удар', icon: '💢',
      desc: 'Руны атаки имеют 20% шанс нанести ×1.5 урона',
      critChance: 0.20,
      critPower:  1.5,
    },

    // ── Вампир ──
    vampAttackHeal: {
      name: 'Кровопийца', icon: '🩸',
      desc: 'При сжигании рун атаки восстанавливает 30% нанесённого урона',
      healRatio: 0.30,
    },
    vampDodge: {
      name: 'Тень', icon: '💨',
      desc: '20% шанс уклонения от любой атаки',
      dodgeChance: 0.20,
    },
    vampRegen: {
      name: 'Регенерация вампира', icon: '🧬',
      desc: 'Восстанавливает 10% макс. HP в начале каждого хода',
      regenPercent: 0.10,
    },

    // ── Паладин ──
    holyHeal: {
      name: 'Святое исцеление', icon: '✨',
      desc: 'Руны исцелений дают на 50% больше HP',
      healMultiplier: 1.5,
    },
    holyOverheal: {
      name: 'Переизбыток веры', icon: '💫',
      desc: 'Излишек исцеления при полном HP наносит урон врагу',
    },

    // ── Рыцарь ──
    ironWill: {
      name: 'Железная воля', icon: '🔰',
      desc: 'Получая урон, приобретает броню = 50% от полученного урона',
      armorFromDamage: 0.50,
    },
    counterBlock: {
      name: 'Контратака', icon: '⚔️',
      desc: '20% шанс заблокировать 50% урона и ударить в ответ ×3 урона',
      chance:     0.25,
      blockPower: 0.50,
    },
    lastStand: {
      name: 'Последний рубеж', icon: '🏰',
      desc: 'При получении смертельного урона - выживаешь, восполняет 30% HP. Срабатывает раз с четыре хода',
      cooldown: 4,
      hpPercent: 0.30,
    },

    // ── Чернокнижник ──
    painFueled: {
      name: 'Боль как топливо', icon: '🖤',
      desc: 'Получаемый урон восполняет ману на 50% от урона',
      manaRatio: 0.50,
    },

    // ── Маг ──
    arcaneChanneling: {
      name: 'Аркановый канал', icon: '⚗️',
      desc: 'Руны маны дают в 2 раза больше маны',
      manaMultiplier: 2.0,
    },
    manaOverflow: {
      name: 'Переполнение маны', icon: '🌀',
      desc: 'При полной мане руны кристаллов увеличивают максимум маны на 25% прироста',
      overflowRatio: 0.25,
    },

    // ── Рыцарь Смерти ──
    deathShroud: {
      name: 'Покров Смерти', icon: '🌑',
      desc: 'При HP < 75% входящий урон −15%; при HP < 50% входящий урон −30%',
      thresholdHigh: 0.75, reductionHigh: 0.15,
      thresholdLow:  0.50, reductionLow:  0.30,
    },
    plagueMark: {
      name: 'Метка Чумы', icon: '🦠',
      desc: 'Каждое совпадение рун атаки добавляет стак Чумы: −1% HP/ход на 5 ходов. Стаки суммируются бесконечно, таймер обновляется.',
      hpPercent: 0.01,
      turns: 5,
    },
    undying: {
      name: 'Бессмертный', icon: '🪦',
      desc: '50% шанс воскреснуть с 15% HP при смерти (один раз за бой)',
      chance:        0.50,
      revivePercent: 0.15,
    },

  },

  /* ── ACTIVE SKILLS ──────────────────────────────── */
  SKILLS: {

    // ── Берсерк ──
    burnSwords: {
      name: '🔥 Жажда крови', manaCost: 60,
      desc: 'Активирует все ⚔️ на поле — 12 урона за каждую (с бонусом Ярости)',
      action: 'BURN_TYPE',
      params: { gemType: 'sword', damagePerGem: 12 },
    },

    // ── Вампир ──
    vampirism: {
      name: '🩸 Вампиризм', manaCost: 70,
      desc: 'Похищает 30% текущего HP у противника',
      action: 'DRAIN_HP',
      params: { drainRatio: 0.30 },
    },
    lifeSwap: {
      name: '🔄 Обмен жизнями', manaCost: 80,
      desc: 'Обменивается процентами HP с противником',
      action: 'LIFE_SWAP',
      params: {},
    },

    // ── Паладин ──
    holyLight: {
      name: '✨ Святой свет', manaCost: 60,
      desc: 'Восстанавливает 40% от максимального HP',
      action: 'HEAL_PERCENT',
      params: { percent: 0.40 },
    },
    divineStun: {
      name: '⚡ Божий суд', manaCost: 90,
      desc: 'Оглушает противника — он пропускает 3 хода',
      action: 'STUN',
      params: { turns: 3 },
    },

    // ── Рыцарь ──
    guardedStrike: {
      name: '🛡️ Глухая оборона', manaCost: 60,
      desc: 'Следующие 3 хода: контратака срабатывает 100%',
      action: 'GUARD',
      params: { turns: 3 },
    },
    
    shieldBash: {
      name: '⚔️ Удар щитом', manaCost: 40,
      desc: 'Высвобождает всю накопленную броню, нанося урон равный ей врагу',
      action: 'SHIELD_BASH',
      params: {},
    },

    // ── Чернокнижник ──
    curse: {
      name: '🩻 Проклятье', manaCost: 30,
      desc: 'Снимает 10% HP врага каждый ход на 4 хода. Повторное наложение обновляет таймер и суммирует %',
      action: 'CURSE',
      params: { turns: 4, hpPercent: 0.1 },
    },
    damageReflect: {
      name: '🪞 Отражение', manaCost: 65,
      desc: 'На 3 хода отражает весь входящий урон обратно без повреждений для себя',
      action: 'DAMAGE_REFLECT',
      params: { turns: 3 },
    },
    soulDrain: {
      name: '💀 Вытягивание души', manaCost: 55,
      desc: 'Забирает у врага 10% всех ресурсов и характеристик',
      action: 'SOUL_DRAIN',
      params: {},
    },

    // ── Маг ──
    manaShield: {
      name: '🔮 Щит маны', manaCost: 50,
      desc: 'На 2 хода: входящий урон поглощается маной вместо HP',
      action: 'MANA_SHIELD',
      params: { turns: 2 },
    },
    gemExplosion: {
      name: '💥 Взрыв рун', manaCost: 70,
      desc: 'Взрывает все руны случайного типа — каждая даёт свой обычный эффект',
      action: 'EXPLODE_RANDOM',
      params: {},
    },
    armageddon: {
      name: '☄️ Армагеддон', manaCost: 200,
      desc: 'Взрывает ВСЕ руны на поле — каждая даёт свой обычный эффект',
      action: 'ARMAGEDDON',
      params: {},
    },

    // ── Рыцарь Смерти ──
    graveTouch: {
      name: '💀 Прикосновение Могилы', manaCost: 50,
      desc: 'Превращает все руны исцеления 🧪 на поле в руны атаки ⚔️',
      action: 'CONVERT_HEAL_TO_SWORD',
      params: {},
    },

  },

  /* ── ENEMY VARIANTS ─────────────────────────────── */
  ENEMY_VARIANTS: {
    berserker:   { name: 'Берсерк',        portrait: 'assets/classes/berserk.png' },
    vampire:     { name: 'Вампир',         portrait: 'assets/classes/vampire.png' },
    paladin:     { name: 'Паладин',        portrait: 'assets/classes/palladin.png' },
    knight:      { name: 'Рыцарь',         portrait: 'assets/classes/knight.png' },
    mage:        { name: 'Маг',            portrait: 'assets/classes/mage.png' },
    warlock:     { name: 'Чернокнижник',   portrait: 'assets/classes/warlock.png' },
    deathKnight: { name: 'Рыцарь Смерти',  portrait: 'assets/classes/death-kniight.png' },
  },

};