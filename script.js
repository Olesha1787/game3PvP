/* ══ SHORTHAND ══════════════════════════════════════ */
const GC = window.GAME_CONFIG;

/* ══ SOUND MANAGER ═══════════════════════════════════ */
class SoundManager {
  constructor(){
    this.sounds = {};
    this.enabled = true;
    this._load('click', 'assets/sounds/gems.wav');
  }
  _load(name, src){
    const audio = new Audio(src);
    audio.preload = 'auto';
    this.sounds[name] = audio;
  }
  play(name, vol=0.4){
    if(!this.enabled || !this.sounds[name]) return;
    const s = this.sounds[name].cloneNode();
    s.volume = vol;
    s.play().catch(()=>{});
  }
  loadSound(name, src){ this._load(name, src); }
  toggle(){ this.enabled = !this.enabled; return this.enabled; }
}
const SFX = new SoundManager();

/* ═══════════════════════════════════════════════════
   MODULE: EventBus
═══════════════════════════════════════════════════ */
class EventBus {
  constructor(){ this._m={}; }
  on(e,f){ (this._m[e]??=[]).push(f); return this; }
  emit(e,d){ (this._m[e]||[]).forEach(f=>f(d)); }
}

/* ═══════════════════════════════════════════════════
   MODULE: Gem
═══════════════════════════════════════════════════ */
const GEM_TYPES = ['sword','potion','crystal','shield'];
const GEM_EMOJI = { sword:'⚔️', potion:'🧪', crystal:'💎', shield:'🛡️' };
const GEM_CLASS = { sword:'gem-sword', potion:'gem-potion', crystal:'gem-crystal', shield:'gem-shield' };
const GEM_IMG = { sword:'assets/gems/gem-attack.png', potion:'assets/gems/gem-health.png', crystal:'assets/gems/gem-mana.png', shield:'assets/gems/gem-armor.png' };

class Gem {
  constructor(type){ this.type = type; }
  static random(){ return new Gem(GEM_TYPES[Math.floor(Math.random()*GEM_TYPES.length)]); }
}

/* ═══════════════════════════════════════════════════
   MODULE: Character  (base class for Player and AI)
═══════════════════════════════════════════════════ */
class Character {
  constructor(classId, cfg={}){
    this.classId  = classId;
    const clsCfg  = GC.CLASSES[classId] || {};
    const merged  = { ...GC.BASE_STATS, ...clsCfg.stats };

    this.name     = cfg.name     ?? clsCfg.name     ?? 'Unknown';
    this.portrait = cfg.portrait ?? clsCfg.portrait ?? '👤';
    this.maxHp    = merged.maxHp;
    this.hp       = this.maxHp;
    this.maxMana  = merged.maxMana;
    this.mana     = 0;

    this.damage      = merged.damage;
    this.critChance  = merged.critChance;
    this.critPower   = merged.critPower;
    this.dodgeChance = merged.dodgeChance;
    this.blockChance = merged.blockChance;
    this.blockPower  = merged.blockPower;
    this.regen       = merged.regen;
    this.baseArmor   = merged.baseArmor;
    this.tempArmor   = 0;

    this.passives  = [...(clsCfg.passives || [])];
    this.actives   = [...(clsCfg.actives  || [])];

    // Apply passive stat overrides
    for(const pid of this.passives){
      const p = GC.PASSIVES[pid];
      if(!p) continue;
      if(p.dodgeChance !== undefined) this.dodgeChance = p.dodgeChance;
    }

    // Per-turn state counters
    this.stunTurns          = 0;
    this.counterBlockTurns  = 0;
    this.manaShieldTurns    = 0;
    this.reflectTurns       = 0;
    this.lastStandTurns     = 0;  // Cooldown for Last Stand (starts at 0 = ready)
    this.lastStandUsedOnce  = false;  // Track if lastStand has been used at least once
    this.curse              = null;
    this.plagueStacks       = 0;
    this.plagueTurns        = 0;
    this.plagueLastTick     = 0;
    this._revived           = false;

    this.isAlive        = true;
    this.totalDmgDealt  = 0;
    this.totalHealed    = 0;
  }

  get armor(){ return this.baseArmor + this.tempArmor; }

  /* Full defensive pipeline. Pass attacker for counter-attack. */
  receiveDamage(rawDmg, attacker = null, bypassReflect = false){
    this._revived = false;
    this._lastStandUsed = false;

    // 0. Reflect (Warlock)
    if(!bypassReflect && this.reflectTurns > 0 && attacker && rawDmg > 0){
      attacker.hp = Math.max(0, attacker.hp - rawDmg);
      if(attacker.hp === 0) attacker.isAlive = false;
      attacker.totalDmgDealt += rawDmg;
      return { dodged:false, blocked:false, damage:0, counter:false, counterDamage:0, shielded:0, reflected: rawDmg };
    }

    // 1. Dodge
    if(Math.random() < this.dodgeChance)
      return { dodged:true, blocked:false, damage:0, counter:false, counterDamage:0, shielded:0, reflected:0 };

    // 2. Death Shroud (Death Knight)
    if(this.passives.includes('deathShroud') && rawDmg > 0){
      const ds    = GC.PASSIVES.deathShroud;
      const hpPct = this.hp / this.maxHp;
      if(hpPct < ds.thresholdLow)
        rawDmg = Math.round(rawDmg * (1 - ds.reductionLow));
      else if(hpPct < ds.thresholdHigh)
        rawDmg = Math.round(rawDmg * (1 - ds.reductionHigh));
    }

    // 3. Mana shield (Mage)
    let shielded = 0;
    if(this.manaShieldTurns > 0 && this.mana > 0){
      shielded  = Math.min(this.mana, rawDmg);
      this.mana -= shielded;
      rawDmg    -= shielded;
      if(rawDmg <= 0)
        return { dodged:false, blocked:false, damage:0, counter:false, counterDamage:0, shielded, reflected:0 };
    }

    let dmg = rawDmg;
    let blocked = false;
    let counter = false;
    let counterDamage = 0;

    // 4. Counter-block (Knight)
    const hasCounterPassive = this.passives.includes('counterBlock');
    const counterChance = this.counterBlockTurns > 0 ? 1.0
                        : (hasCounterPassive ? GC.PASSIVES.counterBlock.chance : 0);

    if(counterChance > 0 && Math.random() < counterChance){
      const cbPower = GC.PASSIVES.counterBlock?.blockPower ?? 0.50;
      dmg     = Math.round(dmg * (1 - cbPower));
      blocked = true;
      counter = true;
      if(attacker){
        const rawCounter = this.damage * 3;
        const postArmor  = Math.max(0, rawCounter - attacker.armor);
        attacker.hp      = Math.max(0, attacker.hp - postArmor);
        if(attacker.hp === 0) attacker.isAlive = false;
        counterDamage    = postArmor;
      }
    } else if(this.blockChance > 0 && Math.random() < this.blockChance){
      dmg     = Math.round(dmg * (1 - this.blockPower));
      blocked = true;
    }

    // 5. Armor mitigation — minimum 1 damage always gets through
    //    FIX: armor is consumed by the damage it absorbs
    const dmgBeforeArmor = dmg;
    dmg = Math.max(1, Math.round(dmg - this.armor));
    const armorAbsorbed = dmgBeforeArmor - dmg;
    if (armorAbsorbed > 0) {
      const fromTemp = Math.min(this.tempArmor, armorAbsorbed);
      this.tempArmor = Math.max(0, this.tempArmor - fromTemp);
      this.baseArmor = Math.max(0, this.baseArmor - (armorAbsorbed - fromTemp));
    }

    // 6. Apply HP damage
    this.hp = Math.max(0, this.hp - dmg);
    
    // Last Stand passive (Knight): first activation any turn, then every 4+ turns
    const canUseLastStand = this.lastStandUsedOnce ? this.lastStandTurns === 0 : true;
    if(this.hp === 0 && this.passives.includes('lastStand') && canUseLastStand){
      this.hp = Math.max(1, Math.round(this.maxHp * 0.30));
      this.lastStandTurns = 4;  // 4 turn cooldown after first use
      this.lastStandUsedOnce = true;
      this._lastStandUsed = true;
    }
    if(this.hp === 0) this.isAlive = false;

    // 7. Iron Will (Knight)
    if(this.passives.includes('ironWill') && dmg > 0)
      this.tempArmor += Math.round(dmg * GC.PASSIVES.ironWill.armorFromDamage);

    // 8. Pain Fueled (Warlock)
    if(this.passives.includes('painFueled') && dmg > 0)
      this.gainMana(Math.round(dmg * GC.PASSIVES.painFueled.manaRatio));

    // 9. Undying (Death Knight)
    if(!this.isAlive && this.passives.includes('undying')){
      const ud = GC.PASSIVES.undying;
      if(Math.random() < ud.chance){
        this.hp       = Math.round(this.maxHp * ud.revivePercent);
        this.isAlive  = true;
        this._revived = true;
        this.passives = this.passives.filter(p => p !== 'undying');
      }
    }

    return { dodged:false, blocked, damage:dmg, counter, counterDamage, shielded, reflected:0 };
  }

  heal(amount){
    const a = Math.min(Math.round(amount), this.maxHp - this.hp);
    this.hp += a;
    this.totalHealed += a;
    return a;
  }
  gainMana(amount){ const a = Math.min(Math.round(amount), this.maxMana - this.mana); this.mana += a; return a; }
  gainTempArmor(a){ this.tempArmor += Math.round(a); }

  tickTurn(){
    if(this.passives.includes('vampRegen')){
      this.heal(Math.round(this.maxHp * GC.PASSIVES.vampRegen.regenPercent));
    } else if(this.regen > 0){
      this.heal(this.regen);
    }
    this.tempArmor = Math.max(0, this.tempArmor - GC.EFFECTS.armorDecayPerTurn);
    if(this.counterBlockTurns > 0) this.counterBlockTurns--;
    if(this.manaShieldTurns   > 0) this.manaShieldTurns--;
    if(this.reflectTurns      > 0) this.reflectTurns--;
    if(this.lastStandTurns   > 0) this.lastStandTurns--;
    if(this.curse && this.curse.turns > 0){
      const curseDmg = Math.round(this.maxHp * this.curse.hpPercent);
      this.hp = Math.max(0, this.hp - curseDmg);
      if(this.hp === 0) this.isAlive = false;
      this.curse.turns--;
      this.curse.lastTick = curseDmg;
      if(this.curse.turns <= 0) this.curse = null;
    }
    this.plagueLastTick = 0;
    if(this.plagueStacks > 0 && this.plagueTurns > 0){
      const plagueDmg     = Math.round(this.maxHp * GC.PASSIVES.plagueMark.hpPercent * this.plagueStacks);
      this.hp             = Math.max(0, this.hp - plagueDmg);
      if(this.hp === 0) this.isAlive = false;
      this.plagueTurns--;
      this.plagueLastTick = plagueDmg;
      if(this.plagueTurns <= 0){ this.plagueStacks = 0; this.plagueTurns = 0; }
    }
  }
}

/* ═══════════════════════════════════════════════════
   MODULE: Player
═══════════════════════════════════════════════════ */
class Player extends Character {
  constructor(classId, cfg={}){ super(classId, cfg); this.turnCount = 0; }
  onTurnEnd(){ this.tickTurn(); this.turnCount++; }
}

/* ═══════════════════════════════════════════════════
   MODULE: AIPlayer
═══════════════════════════════════════════════════ */
class AIPlayer extends Character {
  constructor(classId, cfg={}){ super(classId, cfg); }

  chooseBestMove(board){
    const hpPct    = this.hp / this.maxHp;
    const priority = hpPct < 0.35
      ? ['potion','shield','sword','crystal']
      : ['sword','crystal','shield','potion'];
    const S = GC.BOARD_SIZE;
    let bestMove=null, bestScore=-1;
    const tryDir=(r1,c1,r2,c2)=>{
      const sc = this._scoreSwap(board,r1,c1,r2,c2,priority);
      if(sc > bestScore){ bestScore=sc; bestMove={r1,c1,r2,c2}; }
    };
    for(let r=0;r<S;r++) for(let c=0;c<S;c++){
      if(c<S-1) tryDir(r,c,r,c+1);
      if(r<S-1) tryDir(r,c,r+1,c);
    }
    if(!bestMove || bestScore <= 0){
      for(let r=0;r<S;r++) for(let c=0;c<S;c++){
        if(c<S-1 && board.canSwap(r,c,r,c+1)) return {r1:r,c1:c,r2:r,c2:c+1};
        if(r<S-1 && board.canSwap(r,c,r+1,c)) return {r1:r,c1:c,r2:r+1,c2:c};
      }
    }
    return bestMove;
  }

  _scoreSwap(board,r1,c1,r2,c2,priority){
    const grid = board.grid.map(row=>row.map(g=>g?g.type:null));
    [grid[r1][c1],grid[r2][c2]] = [grid[r2][c2],grid[r1][c1]];
    const matches = board.matchScan(grid);
    if(!matches.length) return 0;
    let score = 0;
    for(const m of matches){
      const pi = priority.indexOf(m.type);
      score += m.gems.length * (1 + (4-Math.max(0,pi)) * 0.18);
    }
    return score;
  }

  chooseSkill(player){
    const myPct   = this.hp / this.maxHp;
    const ordered = myPct < 0.45
      ? ['vampirism','lifeSwap','holyLight','guardedStrike','manaShield',
         'divineStun','curse','damageReflect','soulDrain',
         'burnSwords','graveTouch','gemExplosion','armageddon']
      : ['burnSwords','graveTouch','armageddon','gemExplosion',
         'curse','divineStun','damageReflect','soulDrain','vampirism',
         'guardedStrike','manaShield','lifeSwap','holyLight'];

    for(const id of ordered){
      if(!this.actives.includes(id)) continue;
      const sk = GC.SKILLS[id];
      if(!sk || this.mana < sk.manaCost) continue;
      if(id === 'lifeSwap'){
        const theirPct = player.hp / player.maxHp;
        if(myPct >= theirPct) continue;
      }
      return id;
    }
    return null;
  }

  onTurnEnd(){ this.tickTurn(); }
}

/* ═══════════════════════════════════════════════════
   MODULE: BattleEngine
═══════════════════════════════════════════════════ */
class BattleEngine {
  static _scale(base, count){
    return base * (1 + Math.max(0, count-3) * 0.5);
  }

  static calcDamage(attacker, count){
    let baseDmg = attacker.damage;

    if(attacker.passives.includes('rage')){
      const hpLostPct = (1 - attacker.hp/attacker.maxHp) * 100;
      baseDmg += Math.floor(hpLostPct / 2) * GC.PASSIVES.rage.dmgPerTwoPercent;
    }

    const raw  = BattleEngine._scale(count * baseDmg, count);
    const crit = attacker.critChance > 0 && Math.random() < attacker.critChance;
    return { raw: Math.round(crit ? raw*attacker.critPower : raw), crit };
  }

  static calcHeal(count){
    const fx = GC.EFFECTS;
    return Math.round(fx.healPerGem * count * (1 + Math.max(0,count-3) * fx.healScale));
  }
  static calcMana(count){ return Math.round(count * GC.EFFECTS.manaPerGem); }
  static calcArmor(count){ return count * GC.EFFECTS.armorPerGem; }
}

/* ═══════════════════════════════════════════════════
   MODULE: EffectResolver
═══════════════════════════════════════════════════ */
class EffectResolver {
  applyHealWithOverheal(atk, def, intended){
    const actual = atk.heal(intended);
    let overhealDmg = 0;
    let reflected = 0;
    if(atk.passives.includes('holyOverheal')){
      const overflow = intended - actual;
      if(overflow > 0){
        const res = def.receiveDamage(overflow, atk);
        overhealDmg = res.damage;
        reflected = res.reflected;
        atk.totalDmgDealt += overhealDmg;
      }
    }
    return { actual, overhealDmg, reflected };
  }

  resolve(matches, attacker, defender, cascadeMult=1){
    const grouped = {};
    for(const m of matches) grouped[m.type] = (grouped[m.type]||0) + m.gems.length;
    return Object.entries(grouped)
      .map(([t,c]) => this._apply(t,c,attacker,defender,cascadeMult))
      .filter(Boolean);
  }

  _apply(type, count, atk, def, mult){
    switch(type){
      case 'sword': {
        let { raw, crit } = BattleEngine.calcDamage(atk, count);
        if(atk.passives.includes('berserkerCrit') && !crit){
          if(Math.random() < GC.PASSIVES.berserkerCrit.critChance){
            crit = true;
            raw  = Math.round(raw * GC.PASSIVES.berserkerCrit.critPower);
          }
        }
        const finalRaw = Math.round(raw * mult);
        const res      = def.receiveDamage(finalRaw, atk);
        atk.totalDmgDealt += res.damage;

        let vampHeal = 0;
        if(atk.passives.includes('vampAttackHeal') && res.damage > 0){
          vampHeal = atk.heal(Math.round(res.damage * GC.PASSIVES.vampAttackHeal.healRatio));
        }

        let plagueApplied = false;
        if(atk.passives.includes('plagueMark') && res.damage > 0){
          const pm = GC.PASSIVES.plagueMark;
          def.plagueStacks += count;
          def.plagueTurns   = pm.turns;
          plagueApplied = true;
        }

        return { type, effect:'damage', value:res.damage, crit,
                 dodged:res.dodged, blocked:res.blocked,
                 counter:res.counter, counterDamage:res.counterDamage,
                 vampHeal, shielded:res.shielded,
                 plagueApplied, revived: def._revived, reflected: res.reflected, lastStand: def._lastStandUsed };
      }

      case 'potion': {
        let healAmt = BattleEngine.calcHeal(count) * mult;
        if(atk.passives.includes('holyHeal')) healAmt *= GC.PASSIVES.holyHeal.healMultiplier;
        const { actual, overhealDmg, reflected } = this.applyHealWithOverheal(atk, def, Math.round(healAmt));
        return { type, effect:'heal', value:actual, overhealDmg, reflected };
      }

      case 'crystal': {
        let manaGain = Math.round(BattleEngine.calcMana(count));
        if(atk.passives.includes('arcaneChanneling'))
          manaGain = Math.round(manaGain * GC.PASSIVES.arcaneChanneling.manaMultiplier);
        let maxManaBonus = 0;
        if(atk.passives.includes('manaOverflow') && atk.mana >= atk.maxMana){
          maxManaBonus = Math.round(manaGain * GC.PASSIVES.manaOverflow.overflowRatio);
          atk.maxMana += maxManaBonus;
        }
        const v = atk.gainMana(manaGain);
        return { type, effect:'mana', value:v, maxManaBonus };
      }

      case 'shield': {
        const v = Math.round(BattleEngine.calcArmor(count));
        atk.gainTempArmor(v);
        return { type, effect:'armor', value:v };
      }
    }
    return null;
  }
}

/* ═══════════════════════════════════════════════════
   MODULE: SkillExecutor
═══════════════════════════════════════════════════ */
class SkillExecutor {
  constructor(resolver){ this.resolver = resolver; }
  execute(skillId, caster, target, board){
    const sk = GC.SKILLS[skillId];
    if(!sk || caster.mana < sk.manaCost) return null;
    caster.mana -= sk.manaCost;

    switch(sk.action){

      case 'BURN_TYPE': {
        const { gemType, damagePerGem } = sk.params;
        const gems = [];
        for(let r=0;r<board.size;r++) for(let c=0;c<board.size;c++)
          if(board.grid[r][c]?.type === gemType) gems.push({r,c});
        if(!gems.length) return { action:'BURN_TYPE', gemType, count:0, damage:0, dodged:false, fallen:new Set() };

        let dmgMult = 1;
        if(caster.passives.includes('rage')){
          const hpLostPct = (1 - caster.hp/caster.maxHp) * 100;
          const rageBonus = Math.floor(hpLostPct/2) * GC.PASSIVES.rage.dmgPerTwoPercent;
          dmgMult = (caster.damage + rageBonus) / caster.damage;
        }
        const totalRaw = Math.round(gems.length * damagePerGem * dmgMult);
        const res      = target.receiveDamage(totalRaw, caster);
        caster.totalDmgDealt += res.damage;

        for(const {r,c} of gems) board.grid[r][c] = null;
        const fallen = board.applyGravity();
        return { action:'BURN_TYPE', gemType, count:gems.length, damage:res.damage, dodged:res.dodged, fallen, reflected:res.reflected };
      }

      case 'DRAIN_HP': {
        const drain  = Math.round(target.hp * sk.params.drainRatio);
        target.hp    = Math.max(0, target.hp - drain);
        if(target.hp === 0) target.isAlive = false;
        caster.totalDmgDealt += drain;
        const healed = caster.heal(drain);
        return { action:'DRAIN_HP', damage:drain, healed };
      }

      case 'LIFE_SWAP': {
        const myPct   = caster.hp / caster.maxHp;
        const theirPct = target.hp / target.maxHp;
        caster.hp = Math.max(1, Math.round(theirPct * caster.maxHp));
        target.hp = Math.max(0, Math.round(myPct   * target.maxHp));
        if(target.hp === 0) target.isAlive = false;
        return { action:'LIFE_SWAP', casterHp:caster.hp, targetHp:target.hp };
      }

      case 'HEAL_PERCENT': {
        const intended = Math.round(caster.maxHp * sk.params.percent);
        const { actual, overhealDmg, reflected } = this.resolver.applyHealWithOverheal(caster, target, intended);
        return { action:'HEAL_PERCENT', healed:actual, overhealDmg, reflected };
      }

      case 'STUN': {
        target.stunTurns += sk.params.turns;
        return { action:'STUN', turns:sk.params.turns };
      }

      case 'GUARD': {
        caster.counterBlockTurns += sk.params.turns;
        return { action:'GUARD', turns:sk.params.turns };
      }

      case 'MANA_SHIELD': {
        caster.manaShieldTurns += sk.params.turns;
        return { action:'MANA_SHIELD', turns:sk.params.turns };
      }

      case 'CURSE': {
        const { turns, hpPercent } = sk.params;
        if(!target.curse){
          target.curse = { turns, hpPercent, lastTick:0 };
        } else {
          target.curse.turns      = turns;
          target.curse.hpPercent += hpPercent;
        }
        return { action:'CURSE', turns, hpPercent, stacked: target.curse.hpPercent > hpPercent };
      }

      case 'DAMAGE_REFLECT': {
        caster.reflectTurns += sk.params.turns;
        return { action:'DAMAGE_REFLECT', turns:sk.params.turns };
      }

      case 'SOUL_DRAIN': {
        const drain = { hp: 0, mana: 0, armor: 0, dodge: 0, crit: 0, damage: 0, maxHp: 0, maxMana: 0 };

        // Drain 10% HP (minimum 1)
        const hpDrain = Math.max(1, Math.floor(target.hp * 0.1));
        if(hpDrain > 0 && target.hp > 0){
          const actualHpDrain = Math.min(hpDrain, target.hp);
          target.hp -= actualHpDrain;
          caster.hp = Math.min(caster.hp + actualHpDrain, caster.maxHp);
          drain.hp = actualHpDrain;
        }

        // Drain 10% Mana (minimum 1)
        const manaDrain = Math.max(1, Math.floor(target.mana * 0.1));
        if(manaDrain > 0 && target.mana > 0){
          const actualManaDrain = Math.min(manaDrain, target.mana);
          target.mana -= actualManaDrain;
          caster.mana = Math.min(caster.mana + actualManaDrain, caster.maxMana);
          drain.mana = actualManaDrain;
        }

        // FIX: Drain 10% Armor — simply REMOVE it from target, do NOT transfer to caster
        // (transferring created runaway armor accumulation, causing warlock to always take 1 damage)
        const totalArmor = target.tempArmor + target.baseArmor;
        const armorDrain = Math.max(1, Math.floor(totalArmor * 0.1));
        if(armorDrain > 0 && totalArmor > 0){
          const actualArmorDrain = Math.min(armorDrain, totalArmor);
          const takeFromTemp = Math.min(target.tempArmor, actualArmorDrain);
          const takeFromBase = actualArmorDrain - takeFromTemp;
          target.tempArmor -= takeFromTemp;
          target.baseArmor = Math.max(0, target.baseArmor - takeFromBase);
          drain.armor = actualArmorDrain;
          // NOTE: armor is destroyed, not transferred — prevents warlock from becoming unkillable
        }

        // Steal dodge chance (minimum 0.01 = 1%)
        if(target.dodgeChance > 0){
          const dodgeSteal = Math.max(0.01, Math.floor(target.dodgeChance * 0.1 * 100) / 100);
          if(dodgeSteal > 0){
            drain.dodge = dodgeSteal;
            target.dodgeChance = Math.max(0, target.dodgeChance - dodgeSteal);
            caster.dodgeChance = Math.min(0.5, caster.dodgeChance + dodgeSteal);
          }
        }

        // Steal crit chance (minimum 0.01 = 1%)
        if(target.critChance > 0){
          const critSteal = Math.max(0.01, Math.floor(target.critChance * 0.1 * 100) / 100);
          if(critSteal > 0){
            drain.crit = critSteal;
            target.critChance = Math.max(0, target.critChance - critSteal);
            caster.critChance = Math.min(0.8, caster.critChance + critSteal);
          }
        }

        // Drain damage (minimum 1)
        const damageSteal = Math.max(1, Math.floor(target.damage * 0.1));
        if(damageSteal > 0 && target.damage > 0){
          drain.damage = damageSteal;
          target.damage = Math.max(1, target.damage - damageSteal);
          caster.damage += damageSteal;
        }

        // Drain max HP (minimum 1)
        const maxHpSteal = Math.max(1, Math.floor(target.maxHp * 0.1));
        if(maxHpSteal > 0 && target.maxHp > 50){
          drain.maxHp = maxHpSteal;
          target.maxHp = Math.max(50, target.maxHp - maxHpSteal);
          caster.maxHp += maxHpSteal;
          caster.hp = Math.min(caster.hp + maxHpSteal, caster.maxHp);
        }

        // Drain max Mana (minimum 1)
        const maxManaSteal = Math.max(1, Math.floor(target.maxMana * 0.1));
        if(maxManaSteal > 0 && target.maxMana > 30){
          drain.maxMana = maxManaSteal;
          target.maxMana = Math.max(30, target.maxMana - maxManaSteal);
          caster.maxMana += maxManaSteal;
        }

        return { action:'SOUL_DRAIN', drain };
      }

      case 'SHIELD_BASH': {
        const totalArmor = caster.baseArmor + caster.tempArmor;
        caster.baseArmor = 0;
        caster.tempArmor = 0;
        let damage = 0;
        let reflected = 0;  // FIX: declare outside if-block to avoid ReferenceError
        if(totalArmor > 0){
          const res = target.receiveDamage(totalArmor, caster);
          damage = res.damage;
          reflected = res.reflected;
          caster.totalDmgDealt += damage;
        }
        return { action:'SHIELD_BASH', armorSpent:totalArmor, damage, reflected };
      }

      case 'EXPLODE_RANDOM': {
        const byType = {};
        for(let r=0;r<board.size;r++) for(let c=0;c<board.size;c++){
          const g = board.grid[r][c];
          if(g) (byType[g.type] ??= []).push({r,c});
        }
        const types = Object.keys(byType);
        if(!types.length) return null;
        const gemType = types[Math.floor(Math.random() * types.length)];
        const gems    = byType[gemType];
        const matches  = [{ type: gemType, gems }];
        const results  = this.resolver.resolve(matches, caster, target, 1);
        for(const {r,c} of gems) board.grid[r][c] = null;
        const fallen = board.applyGravity();
        return { action:'EXPLODE_RANDOM', gemType, count:gems.length, results, fallen };
      }

      case 'ARMAGEDDON': {
        const byType = {};
        for(let r=0;r<board.size;r++) for(let c=0;c<board.size;c++){
          const g = board.grid[r][c];
          if(g) (byType[g.type] ??= []).push({r,c});
        }
        const matches   = Object.entries(byType).map(([type,gems])=>({ type, gems }));
        const totalCount = matches.reduce((s,m)=>s+m.gems.length, 0);
        const results   = this.resolver.resolve(matches, caster, target, 1);
        for(let r=0;r<board.size;r++) for(let c=0;c<board.size;c++) board.grid[r][c] = null;
        const fallen = board.applyGravity();
        return { action:'ARMAGEDDON', count:totalCount, results, fallen };
      }

      case 'CONVERT_HEAL_TO_SWORD': {
        let converted = 0;
        for(let r=0;r<board.size;r++) for(let c=0;c<board.size;c++){
          if(board.grid[r][c]?.type === 'potion'){
            board.grid[r][c] = new Gem('sword');
            converted++;
          }
        }
        return { action:'CONVERT_HEAL_TO_SWORD', converted };
      }
    }
    return null;
  }
}

/* ═══════════════════════════════════════════════════
   MODULE: GemBoard
═══════════════════════════════════════════════════ */
class GemBoard {
  constructor(size=GC.BOARD_SIZE){ this.size=size; this.grid=[]; this._init(); }

  _init(){
    const S = this.size;
    this.grid = Array.from({length:S}, ()=>Array(S).fill(null));
    for(let r=0;r<S;r++){
      for(let c=0;c<S;c++){
        const forbidden = new Set();
        if(c >= 2 && this.grid[r][c-1]?.type === this.grid[r][c-2]?.type)
          forbidden.add(this.grid[r][c-1].type);
        if(r >= 2 && this.grid[r-1][c]?.type === this.grid[r-2][c]?.type)
          forbidden.add(this.grid[r-1][c].type);

        const allowed = GEM_TYPES.filter(t => !forbidden.has(t));
        const type    = allowed[Math.floor(Math.random() * allowed.length)];
        this.grid[r][c] = new Gem(type);
      }
    }
  }

  findMatches(){ return this.matchScan(this._types()); }

  matchScan(grid){
    const S=this.size, matches=[];
    for(let r=0;r<S;r++) for(let c=0;c<S;){
      const t=grid[r][c]; if(!t){c++;continue;}
      let l=1; while(c+l<S && grid[r][c+l]===t) l++;
      if(l>=3) matches.push({type:t, gems:Array.from({length:l},(_,i)=>({r,c:c+i}))});
      c+=l;
    }
    for(let c=0;c<S;c++) for(let r=0;r<S;){
      const t=grid[r][c]; if(!t){r++;continue;}
      let l=1; while(r+l<S && grid[r+l][c]===t) l++;
      if(l>=3) matches.push({type:t, gems:Array.from({length:l},(_,i)=>({r:r+i,c}))});
      r+=l;
    }
    return matches;
  }

  swap(r1,c1,r2,c2){ [this.grid[r1][c1],this.grid[r2][c2]]=[this.grid[r2][c2],this.grid[r1][c1]]; }

  canSwap(r1,c1,r2,c2){
    this.swap(r1,c1,r2,c2);
    const ok = this.findMatches().length > 0;
    this.swap(r1,c1,r2,c2);
    return ok;
  }

  trySwap(r1,c1,r2,c2){
    this.swap(r1,c1,r2,c2);
    if(this.findMatches().length === 0){ this.swap(r1,c1,r2,c2); return false; }
    return true;
  }

  removeMatches(matches){
    const cells = new Set(matches.flatMap(m=>m.gems.map(g=>`${g.r},${g.c}`)));
    for(const k of cells){
      const [r,c] = k.split(',').map(Number);
      this.grid[r][c] = null;
    }
  }

  applyGravity(){
    const S=this.size, moved=new Set();
    for(let c=0;c<S;c++){
      let wr=S-1;
      for(let r=S-1;r>=0;r--){
        if(this.grid[r][c]){
          if(wr!==r){ moved.add(`${wr},${c}`); this.grid[wr][c]=this.grid[r][c]; this.grid[r][c]=null; }
          wr--;
        }
      }
      for(let r=wr;r>=0;r--){
        const forbidden = new Set();
        if(r+2 < S && this.grid[r+1][c]?.type === this.grid[r+2][c]?.type && this.grid[r+1][c])
          forbidden.add(this.grid[r+1][c].type);
        if(c >= 2 && this.grid[r][c-1]?.type === this.grid[r][c-2]?.type && this.grid[r][c-1])
          forbidden.add(this.grid[r][c-1].type);

        const allowed = GEM_TYPES.filter(t => !forbidden.has(t));
        const type    = allowed[Math.floor(Math.random() * allowed.length)];
        this.grid[r][c] = new Gem(type);
        moved.add(`${r},${c}`);
      }
    }
    return moved;
  }

  hasValidMoves(){
    const S=this.size;
    for(let r=0;r<S;r++) for(let c=0;c<S;c++){
      if(c<S-1 && this.canSwap(r,c,r,c+1)) return true;
      if(r<S-1 && this.canSwap(r,c,r+1,c)) return true;
    }
    return false;
  }

  shuffle(){ this._init(); }
  _types(){ return this.grid.map(row=>row.map(g=>g?g.type:null)); }
}

/* ═══════════════════════════════════════════════════
   MODULE: UIRenderer
═══════════════════════════════════════════════════ */
class UIRenderer {
  constructor(game){ this.game=game; this.selected=null; }

  renderCharSelect(){
    const container = document.getElementById('cs-cards');
    container.innerHTML = '';
    for(const [classId, cls] of Object.entries(GC.CLASSES)){
      const card = document.createElement('div');
      card.className = 'cs-card';
      card.dataset.class = classId;

      const passiveHtml = cls.passives.map(pid=>{
        const p = GC.PASSIVES[pid];
        if(!p) return '';
        return `<div class="cs-passive"><div class="cs-skill-icon">${p.icon}</div><div class="cs-skill-info"><div class="cs-skill-title-row"><b>${p.name}</b></div><div style="font-size:11px">${p.desc}</div></div></div>`;
      }).join('');

      const activeHtml = cls.actives.map(sid=>{
        const sk = GC.SKILLS[sid];
        if(!sk) return '';
        const parts = sk.name.split(' ');
        const icon  = parts.length > 1 ? parts[0] : '✨';
        const name  = parts.length > 1 ? parts.slice(1).join(' ') : sk.name;
        return `<div class="cs-active"><div class="cs-skill-icon">${icon}</div><div class="cs-skill-info"><div class="cs-skill-title-row"><b style="color:#80b8ff">${name}</b><span class="cs-mana-cost">💙${sk.manaCost}</span></div><div style="font-size:11px">${sk.desc}</div></div></div>`;
      }).join('');

      card.innerHTML = `
        <div class="cs-left">
          <div class="cs-portrait"><img src="${cls.portrait}" alt="${cls.name}"></div>
          <div class="cs-name" style="color:${cls.color}">${cls.name}</div>
          <div class="cs-stats">
            <span>❤️ <b>${cls.stats.maxHp ?? GC.BASE_STATS.maxHp}</b></span>
            <span>⚔️ <b>${cls.stats.damage ?? GC.BASE_STATS.damage}</b></span>
            <span>💙 <b>${cls.stats.maxMana ?? GC.BASE_STATS.maxMana}</b></span>
          </div>
        </div>
        <div class="cs-right">
          <div class="cs-desc">${cls.desc}</div>
          <div class="cs-section">
            <div class="cs-section-title">Пассивные скиллы</div>
            ${passiveHtml}
          </div>
          <div class="cs-section">
            <div class="cs-section-title">Активные скиллы</div>
            ${activeHtml}
          </div>
        </div>`;

      card.addEventListener('click', ()=>this._selectClass(classId));
      container.appendChild(card);
    }
  }

  _selectClass(classId){
    document.querySelectorAll('.cs-card').forEach(c=>c.classList.remove('selected'));
    const card = document.querySelector(`.cs-card[data-class="${classId}"]`);
    if(card) card.classList.add('selected');
    this.game._selectedClass = classId;
    this.game.startBattle();
  }

  render(){
    this.renderPanel('player', this.game.player);
    this.renderPanel('ai',     this.game.ai);
    this.renderBoard();
    this.updateTurnUI();
  }

  renderPanel(side, char){
    const el = document.getElementById(`${side}-panel`);
    if(!el) return;

    const cls = GC.CLASSES[char.classId] || {};
    el.querySelector('.char-portrait').innerHTML   = char.portrait ? `<img src="${char.portrait}" alt="${char.name}">` : '';
    el.querySelector('.char-name').textContent       = char.name;
    el.querySelector('.char-class-label').textContent= cls.name || '';

    el.querySelector('.hp-text').textContent    = `${char.hp}/${char.maxHp}`;
    el.querySelector('.mana-text').textContent  = `${char.mana}/${char.maxMana}`;
    el.querySelector('.hp-fill').style.width    = `${Math.max(0,char.hp/char.maxHp*100)}%`;
    el.querySelector('.mana-fill').style.width  = `${Math.max(0,char.mana/char.maxMana*100)}%`;

    el.querySelector('.stat-dmg').textContent   = char.damage;
    el.querySelector('.stat-crit').textContent  = `${Math.round(char.critChance*100)}%`;
    el.querySelector('.stat-dodge').textContent = `${Math.round(char.dodgeChance*100)}%`;
    el.querySelector('.stat-regen').textContent = char.regen;

    el.querySelector('.armor-val').textContent = char.armor;

    const passRow = document.getElementById(`${side}-passives`);
    if(passRow){
      passRow.innerHTML = char.passives.map(pid=>{
        const p = GC.PASSIVES[pid];
        return p ? `<div class="passive-chip" data-tooltip="${p.name}:\n${p.desc}">${p.icon}</div>` : '';
      }).join('');
    }

    const stunEl = document.getElementById(`${side}-stun`);
    if(stunEl){ stunEl.style.display = char.stunTurns > 0 ? 'block' : 'none'; stunEl.textContent = `💤 Оглушён (${char.stunTurns} хода)`; }

    const guardEl = document.getElementById(`${side}-guard`);
    if(guardEl){ guardEl.style.display = char.counterBlockTurns > 0 ? 'block' : 'none'; guardEl.innerHTML = `🛡️ Оборона: <span>${char.counterBlockTurns}</span> хода`; }

    const shieldEl = document.getElementById(`${side}-manashield`);
    if(shieldEl){ shieldEl.style.display = char.manaShieldTurns > 0 ? 'block' : 'none'; shieldEl.innerHTML = `🔮 Щит маны: <span>${char.manaShieldTurns}</span> хода`; }

    const reflectEl = document.getElementById(`${side}-reflect`);
    if(reflectEl){ reflectEl.style.display = char.reflectTurns > 0 ? 'block' : 'none'; reflectEl.innerHTML = `🪞 Отражение: <span>${char.reflectTurns}</span> хода`; }

    const curseEl = document.getElementById(`${side}-curse`);
    if(curseEl){
      const hasCurse = char.curse && char.curse.turns > 0;
      curseEl.style.display = hasCurse ? 'block' : 'none';
      if(hasCurse) curseEl.innerHTML = `🩻 Проклятье: <span>${char.curse.turns}</span> хода (${Math.round(char.curse.hpPercent*100)}%/ход)`;
    }

    const plagueEl = document.getElementById(`${side}-plague`);
    if(plagueEl){
      const hasPlague = char.plagueStacks > 0 && char.plagueTurns > 0;
      plagueEl.style.display = hasPlague ? 'block' : 'none';
      if(hasPlague) plagueEl.innerHTML = `🦠 Чума ×${char.plagueStacks} (${char.plagueTurns} ход)`;
    }

    if(side === 'player') this._renderPlayerSkills(char);
    else this._renderAiSkillsReadonly(char);
  }

  _renderPlayerSkills(char){
    const el = document.getElementById('player-skills');
    if(!el) return;
    el.innerHTML = '';
    for(const skillId of char.actives){
      const sk = GC.SKILLS[skillId];
      if(!sk) continue;
      const hasMana = char.mana >= sk.manaCost;
      const skillUsed = this.game._usedSkillsThisTurn.has(skillId);
      const canUse  = hasMana && !skillUsed && this.game.playerTurn && !this.game.animating && char.stunTurns === 0;
      const parts   = sk.name.split(' ');
      const icon    = parts.length > 1 ? parts[0] : '✨';
      const name    = parts.length > 1 ? parts.slice(1).join(' ') : sk.name;
      const btn     = document.createElement('button');
      btn.className = `skill-btn${hasMana && !skillUsed ? ' ready' : ' not-ready'}`;
      btn.disabled  = !canUse;
      btn.innerHTML = `<div class="sk-icon">${icon}</div><span class="sk-cost">💙${sk.manaCost}</span>`;
      btn.setAttribute('data-tooltip', `${name}\n${sk.desc}`);
      btn.addEventListener('click', ()=>{ SFX.play('skill'); this.game.useSkill(skillId); });
      el.appendChild(btn);
    }
  }

  _renderAiSkillsReadonly(char){
    const el = document.getElementById('ai-skills');
    if(!el) return;
    el.innerHTML = '';
    for(const skillId of char.actives){
      const sk = GC.SKILLS[skillId];
      if(!sk) continue;
      const hasMana = char.mana >= sk.manaCost;
      const parts   = sk.name.split(' ');
      const icon    = parts.length > 1 ? parts[0] : '✨';
      const name    = parts.length > 1 ? parts.slice(1).join(' ') : sk.name;
      const btn     = document.createElement('button');
      btn.className = `skill-btn${hasMana ? ' ready' : ' not-ready'}`;
      btn.disabled  = true;
      btn.innerHTML = `<div class="sk-icon">${icon}</div><span class="sk-cost">💙${sk.manaCost}</span>`;
      btn.setAttribute('data-tooltip', `${name}\n${sk.desc}`);
      el.appendChild(btn);
    }
  }

  renderBoard(movedCells=null){
    const boardEl = document.getElementById('gem-board');
    if(!boardEl) return;
    boardEl.innerHTML = '';
    const canClick = this.game.playerTurn && !this.game.animating && this.game.player.stunTurns === 0;
    for(let r=0;r<GC.BOARD_SIZE;r++){
      for(let c=0;c<GC.BOARD_SIZE;c++){
        const gem   = this.game.board.grid[r][c];
        const cell  = document.createElement('div');
        const isSel = this.selected && this.selected.r===r && this.selected.c===c;
        const isNew = movedCells && movedCells.has(`${r},${c}`);
        cell.className = `gem-cell ${gem ? GEM_CLASS[gem.type] : ''} ${!canClick?'locked':''} ${isSel?'selected':''} ${isNew?'gem-fall':''}`.trim();
        if(gem) cell.innerHTML = `<img src="${GEM_IMG[gem.type]}" alt="${GEM_EMOJI[gem.type]}">`;
        if(canClick && gem) cell.addEventListener('click', ()=>this._onGemClick(r,c));
        boardEl.appendChild(cell);
      }
    }
  }

  markMatchedCells(matches){
    const boardEl = document.getElementById('gem-board');
    if(!boardEl) return;
    const allCells = boardEl.querySelectorAll('.gem-cell');
    const S = GC.BOARD_SIZE;
    const positions = new Set(matches.flatMap(m=>m.gems.map(g=>g.r*S+g.c)));
    positions.forEach(idx=>{
      const cell = allCells[idx];
      if(cell){ cell.classList.remove('gem-fall'); cell.classList.add('just-matched'); }
    });
  }

  _onGemClick(r,c){
    if(!this.game.playerTurn || this.game.animating || this.game.player.stunTurns > 0) return;
    if(!this.selected){ this.selected={r,c}; this.renderBoard(); SFX.play('click'); return; }
    const {r:r1,c:c1} = this.selected;
    const adj = (Math.abs(r-r1)===1 && c===c1) || (r===r1 && Math.abs(c-c1)===1);
    this.selected = null;
    SFX.play('click');
    if(adj) this.game.playerMove(r1,c1,r,c);
    else  { this.selected={r,c}; this.renderBoard(); }
  }

  updateTurnUI(){
    const pill = document.getElementById('turn-pill');
    const line = document.getElementById('turn-line');
    if(!pill) return;
    if(!this.game.playerTurn){
      pill.textContent = '🤖 Ход противника…'; pill.className='turn-pill enemy-turn';
    } else if(this.game.player.stunTurns > 0){
      pill.textContent = '💤 Вы оглушены!';   pill.className='turn-pill enemy-turn';
    } else {
      pill.textContent = '🎮 Ваш ход!';        pill.className='turn-pill your-turn';
    }
    if(line) line.textContent = `Ход ${this.game.turnCount+1}`;
  }

  log(msg, type='info'){
    const el = document.getElementById('battle-log');
    if(!el) return;
    const entry = document.createElement('div');
    entry.className = `log-entry l-${type}`;
    entry.textContent = msg;
    el.insertBefore(entry, el.firstChild);
    while(el.children.length > 40) el.removeChild(el.lastChild);
  }

  float(text, side, type){
    const panel = document.getElementById(`${side}-panel`);
    if(!panel) return;
    const el = document.createElement('div');
    el.className = `float-text ft-${type}`;
    el.textContent = text;
    panel.appendChild(el);
    setTimeout(()=>el.remove(), GC.FLOAT_TEXT_MS + 200);
  }

  showGameOver(playerWon, turns){
    document.getElementById('go-icon').textContent  = playerWon ? '🏆' : '💀';
    document.getElementById('go-title').textContent = playerWon ? 'Победа!'  : 'Поражение!';
    document.getElementById('go-sub').textContent   = playerWon ? 'Враг повержен!' : 'Герой пал в бою…';
    document.getElementById('go-turns').textContent = turns;
    
    // Copy battle log to game over modal
    const battleLogEl = document.getElementById('battle-log');
    const goLogEl = document.getElementById('go-log');
    if(battleLogEl && goLogEl){
      goLogEl.innerHTML = battleLogEl.innerHTML;
    }
    
    document.getElementById('gameover-modal').style.display = 'flex';
  }
  hideGameOver(){ document.getElementById('gameover-modal').style.display='none'; }
}

/* ═══════════════════════════════════════════════════
   MODULE: Game  (main controller)
═══════════════════════════════════════════════════ */
class Game {
  constructor(){
    this.bus             = new EventBus();
    this._selectedClass  = null;
    this.resolver        = new EffectResolver();
    this.executor        = new SkillExecutor(this.resolver);
    this.renderer        = new UIRenderer(this);
    this.playerTurn      = true;
    this.animating       = false;
    this.turnCount       = 0;
    this.mode            = 'ai';
    this.myRole          = null;
    this.mp              = null;
    this._pendingHostClass = null;
    this._guestClassId     = null;
    this._usedSkillsThisTurn = new Set();
    this._deathTimeout     = null;

    this._showModeSelect();
  }

  _showModeSelect(){
    document.getElementById('mode-select').style.display        = 'flex';
    document.getElementById('char-select').style.display        = 'none';
    document.getElementById('app').style.display                = 'none';
    document.getElementById('matchmaking-overlay').style.display= 'none';
  }

  startVsAI(){
    this.mode   = 'ai';
    this.myRole = null;
    if(this.mp){ this.mp.close(); this.mp = null; }
    document.getElementById('mode-select').style.display = 'none';
    document.getElementById('char-select').style.display = 'flex';
    const badge = document.getElementById('cs-mode-badge');
    const btn   = document.getElementById('cs-start-btn');
    if(badge) badge.textContent = '🤖 vs AI';
    if(btn)   btn.textContent   = '⚔️ В бой!';
    this.renderer.renderCharSelect();
  }

  findOnlineOpponent(){
    this.mode = 'online';
    document.getElementById('mode-select').style.display        = 'none';
    document.getElementById('matchmaking-overlay').style.display= 'flex';
    document.getElementById('mm-status').textContent            = '';
    document.getElementById('mm-code-block').style.display      = 'none';
    const radioCreate = document.querySelector('input[name="mm-action"][value="create"]');
    if(radioCreate) radioCreate.checked = true;
    document.getElementById('mm-join-input').style.display = 'none';
  }

  _startAsHost(){
    if(typeof Multiplayer === 'undefined'){
      alert('multiplayer.js не загружен'); return;
    }
    if(this.mp) this.mp.close();
    this.myRole = 'host';
    this.mp = new Multiplayer();
    const roomId = this.mp.createRoom();

    this.mp.onPeerJoined = ()=>{
      document.getElementById('mm-status').textContent  = '✅ Соперник подключился! Выбирайте героя.';
      document.getElementById('mm-status').style.color  = '#06d6a0';
      setTimeout(()=>{
        document.getElementById('matchmaking-overlay').style.display = 'none';
        document.getElementById('char-select').style.display         = 'flex';
        const badge = document.getElementById('cs-mode-badge');
        const btn   = document.getElementById('cs-start-btn');
        if(badge) badge.textContent = '🌐 Онлайн (хост)';
        if(btn)  { btn.textContent = '🌐 Готов к бою!'; btn.disabled = false; }
        this.renderer.renderCharSelect();
      }, 1000);
    };
    this.mp.onPeerLeft = ()=>this._opponentLeft();
    this.mp.onMessage  = (type, data)=>this._onNetworkMessage(type, data);

    document.getElementById('mm-code-block').style.display = 'flex';
    document.getElementById('mm-room-code').textContent    = roomId;
    document.getElementById('mm-status').textContent       = '⏳ Ожидаем соперника…';
    document.getElementById('mm-status').style.color       = '';
  }

  _startAsGuest(roomId){
    if(!roomId){ alert('Введите код комнаты'); return; }
    if(typeof Multiplayer === 'undefined'){
      alert('multiplayer.js не загружен'); return;
    }
    if(this.mp) this.mp.close();
    this.myRole = 'guest';
    this.mp = new Multiplayer();
    this.mp.joinRoom(roomId);

    this.mp.onPeerJoined = ()=>{
      document.getElementById('mm-status').textContent  = '✅ Подключено! Выбирайте героя.';
      document.getElementById('mm-status').style.color  = '#06d6a0';
      setTimeout(()=>{
        document.getElementById('matchmaking-overlay').style.display = 'none';
        document.getElementById('char-select').style.display         = 'flex';
        const badge = document.getElementById('cs-mode-badge');
        const btn   = document.getElementById('cs-start-btn');
        if(badge) badge.textContent = '🌐 Онлайн (гость)';
        if(btn)  { btn.textContent = '🌐 Готов к бою!'; btn.disabled = false; }
        this.renderer.renderCharSelect();
      }, 1000);
    };
    this.mp.onPeerLeft = ()=>this._opponentLeft();
    this.mp.onMessage  = (type, data)=>this._onNetworkMessage(type, data);

    document.getElementById('mm-status').textContent = '🔄 Подключаемся…';
    document.getElementById('mm-status').style.color = '';
  }

  _opponentLeft(){
    this.animating = false;
    this.renderer.log('📡 Соперник отключился!', 'info');
    const toast = document.createElement('div');
    toast.className   = 'mp-toast';
    toast.textContent = '❌ Соперник покинул игру. Возврат в меню…';
    document.body.appendChild(toast);
    setTimeout(()=>{ toast.remove(); this.restart(); }, 3000);
  }

  _onNetworkMessage(type, data){
    if(type === 'PLAYER_READY'){
      this._guestClassId = data.classId;
      if(this._pendingHostClass)
        this._doStartOnlineBattle(this._pendingHostClass, this._guestClassId);
      return;
    }
    if(type === 'START'){
      this._doStartOnlineBattle(data.p0ClassId, data.p1ClassId, data.boardGrid);
      return;
    }
    if(type === 'PLAY_ACTIONS'){
      const { boardGrid, p0, p1, turnCount, final } = data;
      this._applyCharState(this.player, p0);
      this._applyCharState(this.ai,     p1);
      this._applyBoardState(boardGrid);
      this.turnCount  = turnCount;
      this.playerTurn = true;
      this.animating  = false;
      this._usedSkillsThisTurn.clear();
      this.renderer.render();
      this.renderer.updateTurnUI();
      if(!this.player.isAlive){ this._endGame(false); return; }
      if(final){ this._endGame(true); return; }
      this.renderer.log('🎮 Ваш ход!', 'player');
      return;
    }
    if(type === 'INSTANT_ACTION'){
      this._onReceiveInstantAction(data);
      return;
    }
  }

  _onReceiveInstantAction(msg){
    const { type, data, boardGrid, p0, p1, turnCount } = msg;
    this._applyCharState(this.player, p0);
    this._applyCharState(this.ai,     p1);
    this._applyBoardState(boardGrid);
    this.turnCount  = turnCount;
    this.playerTurn = false;
    this.renderer.updateTurnUI();
    this.renderer.log('⏳ Ход соперника…', 'info');

    if(type === 'SKILL'){
      const result = this.executor.execute(data.skillId, this.ai, this.player, this.board);
      if(result){
        this._announceSkillResult(data.skillId, 'ai', result, ()=>{
          this.renderer.render();
          if(!this.player.isAlive){ this._endGame(false); return; }
          const needsCascade = ['BURN_TYPE','EXPLODE_RANDOM','ARMAGEDDON','CONVERT_HEAL_TO_SWORD'].includes(result.action);
          if(needsCascade){
            if(result.fallen) this.renderer.renderBoard(result.fallen);
            else              this.renderer.renderBoard();
            setTimeout(()=>{
              this._runCascade('ai', this.ai, this.player, 0, ()=>this._onOpponentTurnComplete());
            }, GC.GEM_FALL_MS + 100);
          } else {
            this._onOpponentTurnComplete();
          }
        });
      } else {
        this._onOpponentTurnComplete();
      }
    } else if(type === 'GEM_SWAP'){
      this.board.trySwap(data.r1, data.c1, data.r2, data.c2);
      this.animating = true;
      this.renderer.renderBoard();
      this._runCascade('ai', this.ai, this.player, 0, ()=>this._onOpponentTurnComplete());
    }
  }

  _onOpponentTurnComplete(){
    this.playerTurn = true;
    this.animating  = false;
    this._usedSkillsThisTurn.clear();
    this.renderer.render();
    this.renderer.updateTurnUI();
    this.renderer.log('🎮 Ваш ход!', 'player');
  }

  _sendInstantAction(type, data){
    if(this.mode !== 'online' || !this.mp) return;
    this.mp.send('INSTANT_ACTION', {
      type, data,
      boardGrid:  this._serializeBoard(),
      p0:         this._serializeChar(this.player),
      p1:         this._serializeChar(this.ai),
      turnCount:  this.turnCount,
    });
  }

  _sendFinalSync(){
    if(!this.mp) return;
    this.mp.send('PLAY_ACTIONS', {
      boardGrid:  this._serializeBoard(),
      p0:         this._serializeChar(this.player),
      p1:         this._serializeChar(this.ai),
      turnCount:  this.turnCount,
      final:      true,
    });
  }

  startBattleOnline(){
    const cid = this._selectedClass;
    if(!cid) return;

    if(this.myRole === 'host'){
      this._pendingHostClass = cid;
      this.mp.send('PLAYER_READY', { classId: cid });
      if(this._guestClassId){
        this._doStartOnlineBattle(cid, this._guestClassId);
      } else {
        const btn = document.getElementById('cs-start-btn');
        if(btn){ btn.textContent = '⏳ Ждём соперника…'; btn.disabled = true; }
      }
    } else {
      this.mp.send('PLAYER_READY', { classId: cid });
      const btn = document.getElementById('cs-start-btn');
      if(btn){ btn.textContent = '⏳ Ждём хоста…'; btn.disabled = true; }
    }
  }

  _doStartOnlineBattle(p0ClassId, p1ClassId, boardGrid=null){
    const myClassId  = this.myRole === 'host' ? p0ClassId : p1ClassId;
    const oppClassId = this.myRole === 'host' ? p1ClassId : p0ClassId;
    const oppCls     = GC.CLASSES[oppClassId] || {};
    const oppVar     = GC.ENEMY_VARIANTS[oppClassId] || {};

    this.board  = new GemBoard();
    if(boardGrid) this._applyBoardState(boardGrid);

    this.player = new Player(myClassId);
    this.ai     = new Character(oppClassId, {
      name:    oppVar.name     || oppCls.name     || 'Соперник',
      portrait:oppVar.portrait || oppCls.portrait || '👤',
    });

    this.renderer   = new UIRenderer(this);
    this.playerTurn = (this.myRole === 'host');
    this.animating  = false;
    this.turnCount  = 0;

    if(this.myRole === 'host'){
      this.mp.send('START', {
        p0ClassId, p1ClassId,
        boardGrid: this._serializeBoard(),
      });
    }

    document.getElementById('char-select').style.display = 'none';
    document.getElementById('app').style.display         = '';
    const btn = document.getElementById('cs-start-btn');
    if(btn){ btn.disabled = false; btn.textContent = '🌐 Готов к бою!'; }

    this.renderer.render();
    const myName  = GC.CLASSES[myClassId]?.name  || myClassId;
    const oppName = oppVar.name || oppCls.name   || oppClassId;
    this.renderer.log(`🌐 Онлайн бой! ${myName} vs ${oppName}`, 'info');
    if(!this.playerTurn) this.renderer.log('⏳ Ход противника — ждём…', 'info');
  }

  _serializeChar(c){
    return {
      classId:c.classId, name:c.name, portrait:c.portrait,
      hp:c.hp, maxHp:c.maxHp, mana:c.mana, maxMana:c.maxMana,
      damage:c.damage,
      critChance:c.critChance, critPower:c.critPower,
      dodgeChance:c.dodgeChance, blockChance:c.blockChance, blockPower:c.blockPower,
      regen:c.regen, baseArmor:c.baseArmor, tempArmor:c.tempArmor,
      passives:[...c.passives], actives:[...c.actives],
      stunTurns:c.stunTurns, counterBlockTurns:c.counterBlockTurns,
      manaShieldTurns:c.manaShieldTurns, reflectTurns:c.reflectTurns,
      curse:c.curse ? {...c.curse} : null,
      plagueStacks:c.plagueStacks, plagueTurns:c.plagueTurns,
      isAlive:c.isAlive, totalDmgDealt:c.totalDmgDealt,
    };
  }

  _applyCharState(c, s){
    Object.assign(c, {
      classId:s.classId, name:s.name, portrait:s.portrait,
      hp:s.hp, maxHp:s.maxHp, mana:s.mana, maxMana:s.maxMana,
      damage:s.damage,
      critChance:s.critChance, critPower:s.critPower,
      dodgeChance:s.dodgeChance, blockChance:s.blockChance, blockPower:s.blockPower,
      regen:s.regen, baseArmor:s.baseArmor, tempArmor:s.tempArmor,
      passives:s.passives, actives:s.actives,
      stunTurns:s.stunTurns, counterBlockTurns:s.counterBlockTurns,
      manaShieldTurns:s.manaShieldTurns, reflectTurns:s.reflectTurns,
      curse:s.curse,
      plagueStacks:s.plagueStacks ?? 0, plagueTurns:s.plagueTurns ?? 0,
      isAlive:s.isAlive, totalDmgDealt:s.totalDmgDealt,
    });
  }

  _serializeBoard(){
    return this.board.grid.map(row=>row.map(g=>g?g.type:null));
  }

  _applyBoardState(gridData){
    this.board.grid = gridData.map(row=>row.map(t=>t?new Gem(t):null));
  }

  startBattle(){
    if(this.mode === 'online'){ this.startBattleOnline(); return; }

    const cid = this._selectedClass;
    if(!cid) return;

    const pool      = Object.keys(GC.CLASSES).filter(c => c !== cid);
    const aiClassId = pool[Math.floor(Math.random() * pool.length)];
    const aiVar     = GC.ENEMY_VARIANTS[aiClassId] || {};

    this.board      = new GemBoard();
    this.player     = new Player(cid);
    this.ai         = new AIPlayer(aiClassId, { name:aiVar.name, portrait:aiVar.portrait });
    this.renderer   = new UIRenderer(this);
    this.playerTurn = true; this.animating = false; this.turnCount = 0;
    this._usedSkillsThisTurn = new Set();

    document.getElementById('char-select').style.display = 'none';
    document.getElementById('app').style.display = '';

    this.renderer.render();
    this.renderer.log(`⚔️ Бой начался! ${GC.CLASSES[cid].name} vs ${aiVar.name||GC.CLASSES[aiClassId].name}`, 'info');
  }

  playerMove(r1,c1,r2,c2){
    if(!this.playerTurn || this.animating) return;
    if(!this.board.trySwap(r1,c1,r2,c2)){
      this.renderer.log('❌ Нет совпадений!','info');
      this.renderer.renderBoard(); return;
    }
    if(this.mode === 'online') this._sendInstantAction('GEM_SWAP', {r1,c1,r2,c2});
    this.animating = true;
    this.renderer.renderBoard();
    this._runCascade('player', this.player, this.ai, 0, ()=>{
      this._afterPlayerTurn();
    });
  }

  _afterPlayerTurn(){
    this.player.onTurnEnd();
    this.turnCount++;
    this._logCurseTick(this.ai,     'ai');
    this._logCurseTick(this.player, 'player');
    this._logPlagueTick(this.ai,     'ai');
    this._logPlagueTick(this.player, 'player');
    this.renderer.render();
    if(!this.ai.isAlive){
      if(this.mode === 'online') this._sendFinalSync();
      this._endGame(true); return;
    }
    if(this.mode === 'online'){
      this.playerTurn = false; this.animating = false;
      this.renderer.updateTurnUI();
      this.renderer.log('⏳ Ход соперника…', 'info');
    } else {
      this._startAiTurn();
    }
  }

  useSkill(skillId){
    if(!this.playerTurn || this.animating || this.player.stunTurns > 0) return;
    const sk = GC.SKILLS[skillId];
    if(!sk || this.player.mana < sk.manaCost) return;
    if(this._usedSkillsThisTurn.has(skillId)) return;
    this._usedSkillsThisTurn.add(skillId);
    if(this.mode === 'online') this._sendInstantAction('SKILL', { skillId });
    this.animating = true;
    const result = this.executor.execute(skillId, this.player, this.ai, this.board);
    if(!result){ this.animating = false; return; }

    this._announceSkillResult(skillId, 'player', result, ()=>{
      this.renderer.render();
      if(!this.ai.isAlive){ this._endGame(true); return; }
      const needsCascade = ['BURN_TYPE','EXPLODE_RANDOM','ARMAGEDDON'].includes(result.action);
      if(needsCascade && result.fallen){
        this.renderer.renderBoard(result.fallen);
        setTimeout(()=>{
          this._runCascade('player', this.player, this.ai, 0, ()=>{
            this.animating = false; this.renderer.render();
          });
        }, GC.GEM_FALL_MS + 100);
      } else if(result.action === 'CONVERT_HEAL_TO_SWORD'){
        this.renderer.renderBoard();
        setTimeout(()=>{
          this._runCascade('player', this.player, this.ai, 0, ()=>{
            this.animating = false;
            this.renderer.render();
            if(!this.ai.isAlive){ this._endGame(true); }
          });
        }, GC.GEM_FALL_MS + 100);
      } else {
        this.animating = false; this.renderer.render();
      }
    });
  }

  _announceSkillResult(skillId, side, result, done){
    const sk    = GC.SKILLS[skillId];
    const aSide = side;
    const dSide = side==='player' ? 'ai' : 'player';
    const aName = side==='player' ? this.player.name : this.ai.name;
    const dName = side==='player' ? this.ai.name     : this.player.name;

    this.renderer.log(`✨ ${aName} применяет: ${sk.name}!`, 'skill');
    SFX.play('skill');

    switch(result.action){
      case 'BURN_TYPE':
        if(!result.count){
          this.renderer.log(`🔥 На поле нет рун ${GEM_EMOJI[result.gemType]}`, 'info');
        } else if(result.dodged){
          this.renderer.log(`💨 ${dName} уклонился!`, 'dodge');
          this.renderer.float('УКЛОН!', dSide, 'dodge');
        } else {
          this.renderer.log(`🔥 ${result.count} рун сожжено → —${result.damage} урона`, 'crit');
          this.renderer.float(`🔥 —${result.damage}`, dSide, 'damage');
        }
        break;

      case 'DRAIN_HP':
        this.renderer.log(`🩸 —${result.damage} у ${dName}, +${result.healed} себе`, 'skill');
        this.renderer.float(`🩸 —${result.damage}`, dSide, 'damage');
        this.renderer.float(`🩸 +${result.healed}`,  aSide, 'heal');
        break;

      case 'LIFE_SWAP': {
        this.renderer.log(`🔄 Обмен жизнями! HP: ${result.casterHp} ↔ ${result.targetHp}`, 'skill');
        this.renderer.float('🔄 ОБМЕН', aSide, 'skill');
        this.renderer.float('🔄 ОБМЕН', dSide, 'skill');
        break;
      }

      case 'HEAL_PERCENT':
        this.renderer.log(`✨ Святой свет: +${result.healed} HP`, 'heal');
        this.renderer.float(`✨ +${result.healed}`, aSide, 'heal');
        if(result.overhealDmg > 0){
          this.renderer.log(`💫 Переизбыток → ${result.overhealDmg} урона ${dName}!`, 'crit');
          setTimeout(()=>this.renderer.float(`💫 —${result.overhealDmg}`, dSide, 'damage'), 350);
        }
        break;

      case 'STUN':
        this.renderer.log(`⚡ ${dName} оглушён на ${result.turns} хода!`, 'stun');
        this.renderer.float('💤 ОГЛУШЕНИЕ', dSide, 'skill');
        break;

      case 'GUARD':
        this.renderer.log(`🛡️ Глухая оборона активна на ${result.turns} хода!`, 'armor');
        this.renderer.float(`🛡️ ОБОРОНА`, aSide, 'armor');
        break;

      case 'MANA_SHIELD':
        this.renderer.log(`🔮 Щит маны активен на ${result.turns} хода!`, 'mana');
        this.renderer.float(`🔮 ЩИТМАНЫ`, aSide, 'mana');
        break;

      case 'CURSE':
        if(result.stacked){
          this.renderer.log(`🩻 Проклятье усилено! ${Math.round(result.hpPercent*100)}%→${Math.round((result.hpPercent*2)*100)}%/ход, ${result.turns} хода`, 'skill');
        } else {
          this.renderer.log(`🩻 ${dName} проклят на ${result.turns} хода (−${Math.round(result.hpPercent*100)}% HP/ход)!`, 'skill');
        }
        this.renderer.float(`🩻 ПРОКЛЯТЬЕ`, dSide, 'skill');
        break;

      case 'DAMAGE_REFLECT':
        this.renderer.log(`🪞 Отражение активно на ${result.turns} хода!`, 'armor');
        this.renderer.float(`🪞 ОТРАЖЕНИЕ`, aSide, 'armor');
        break;

      case 'SOUL_DRAIN': {
        const d = result.drain;
        const parts = [];
        if(d.hp) parts.push(`❤️ ${d.hp}`);
        if(d.mana) parts.push(`💙 ${d.mana}`);
        if(d.armor) parts.push(`🛡️ −${d.armor}`);
        if(d.dodge) parts.push(`💨 +${Math.round(d.dodge*100)}%`);
        if(d.crit) parts.push(`💥 +${Math.round(d.crit*100)}%`);
        if(d.damage) parts.push(`⚔️ +${d.damage}`);
        if(d.maxHp) parts.push(`❤️ max +${d.maxHp}`);
        if(d.maxMana) parts.push(`💙 max +${d.maxMana}`);
        if(parts.length > 0){
          this.renderer.log(`💀 Вытягивание души: ${parts.join(', ')}`, 'skill');
          this.renderer.float(`💀 ДУША`, aSide, 'skill');
        }
        break;
      }

      case 'SHIELD_BASH':
        if(result.armorSpent > 0){
          this.renderer.log(`⚔️ Удар щитом: потрачено ${result.armorSpent} брони → —${result.damage} урона`, 'crit');
          this.renderer.float(`⚔️ —${result.damage}`, dSide, 'damage');
          this.renderer.float(`🛡️ −${result.armorSpent}`, aSide, 'armor');
        } else {
          this.renderer.log(`⚔️ Удар щитом: нет брони для удара`, 'info');
        }
        break;

      case 'EXPLODE_RANDOM':
        this.renderer.log(`💥 Взрыв ${GEM_EMOJI[result.gemType]}! ${result.count} рун сожжено`, 'skill');
        this.renderer.float(`💥 ${GEM_EMOJI[result.gemType]}×${result.count}`, aSide, 'skill');
        this._broadcastResults(result.results, side);
        break;

      case 'ARMAGEDDON':
        this.renderer.log(`☄️ АРМАГЕДДОН! ${result.count} рун сожжено`, 'crit');
        this.renderer.float(`☄️ АРМАГЕДДОН`, aSide, 'skill');
        this._broadcastResults(result.results, side);
        break;

      case 'CONVERT_HEAL_TO_SWORD':
        this.renderer.log(`💀 ${aName}: ${result.converted} рун исцеления → руны атаки!`, 'skill');
        this.renderer.float(`💀 🧪→⚔️ ×${result.converted}`, aSide, 'skill');
        done(); return;
    }
    setTimeout(done, 700);
  }

  _runCascade(side, atk, def, lvl, done){
    const matches = this.board.findMatches();
    if(!matches.length){ done(); return; }

    const mult = 1;
    if(lvl > 0) this.renderer.log(`🔗 КАСКАД ×${lvl+1}!`, 'cascade');

    this.renderer.markMatchedCells(matches);

    this._resolveStaggered(matches, side, atk, def, mult, ()=>{
      this.board.removeMatches(matches);
      const fallen = this.board.applyGravity();
      if(!this.board.hasValidMoves()){
        this.board.shuffle();
        this.renderer.log('🔀 Нет ходов — доска перемешана!', 'info');
      }
      this.renderer.renderBoard(fallen);
      this.renderer.renderPanel('player', this.player);
      this.renderer.renderPanel('ai',     this.ai);
      if(!def.isAlive){ done(); return; }
      setTimeout(()=>this._runCascade(side, atk, def, lvl+1, done), GC.GEM_FALL_MS + GC.CASCADE_PAUSE_MS);
    });
  }

  _resolveStaggered(matches, side, atk, def, mult, done){
    let i=0;
    const next=()=>{
      if(i >= matches.length){
        const elapsed = matches.length * GC.STAGGER_MS;
        setTimeout(done, Math.max(0, GC.GEM_POP_MS - elapsed + 80));
        return;
      }
      const m = matches[i++];
      const results = this.resolver.resolve([m], atk, def, mult);
      this._broadcastResults(results, side);
      this.renderer.renderPanel('player', this.player);
      this.renderer.renderPanel('ai',     this.ai);
      setTimeout(next, GC.STAGGER_MS);
    };
    next();
  }

  _startAiTurn(){
    if(this.mode === 'online') return;
    this.playerTurn = false; this.animating = false;
    this.renderer.updateTurnUI();

    if(this.ai.stunTurns > 0){
      this.ai.stunTurns--;
      this.renderer.log(`💤 ${this.ai.name} оглушён! Пропускает ход (осталось ${this.ai.stunTurns})`, 'stun');
      this.renderer.renderPanel('ai', this.ai);
      setTimeout(()=>this._endAiTurn(), 800);
      return;
    }
    setTimeout(()=>this._doAiTurn(), GC.AI_DELAY_MS);
  }

  _doAiTurn(){
    const skillId = this.ai.chooseSkill(this.player);
    if(skillId){
      const result = this.executor.execute(skillId, this.ai, this.player, this.board);
      if(result){
        this._announceSkillResult(skillId, 'ai', result, ()=>{
          this.renderer.render();
          if(!this.player.isAlive){ this._endGame(false); return; }
          const needsCascade = ['BURN_TYPE','EXPLODE_RANDOM','ARMAGEDDON'].includes(result.action);
          if(needsCascade && result.fallen){
            this.renderer.renderBoard(result.fallen);
            setTimeout(()=>{
              this._runCascade('ai', this.ai, this.player, 0, ()=>this._doAiGemSwap());
            }, GC.GEM_FALL_MS + 100);
          } else if(result.action === 'CONVERT_HEAL_TO_SWORD'){
            this.renderer.renderBoard();
            setTimeout(()=>{
              this._runCascade('ai', this.ai, this.player, 0, ()=>this._doAiGemSwap());
            }, GC.GEM_FALL_MS + 100);
          } else {
            this._doAiGemSwap();
          }
        });
        return;
      }
    }
    this._doAiGemSwap();
  }

  _doAiGemSwap(){
    const move = this.ai.chooseBestMove(this.board);
    if(!move){ this._endAiTurn(); return; }
    const ok = this.board.trySwap(move.r1, move.c1, move.r2, move.c2);
    if(!ok){ this._endAiTurn(); return; }
    this.animating = true;
    this.renderer.renderBoard();
    this._runCascade('ai', this.ai, this.player, 0, ()=>{
      this.ai.onTurnEnd();
      this._logCurseTick(this.player, 'player');
      this._logCurseTick(this.ai,     'ai');
      this._logPlagueTick(this.player, 'player');
      this._logPlagueTick(this.ai,     'ai');
      this.renderer.render();
      if(!this.player.isAlive){ this._endGame(false); return; }
      this._endAiTurn();
    });
  }

  _logCurseTick(char, side){
    if(char.curse && char.curse.lastTick > 0){
      this.renderer.log(`🩻 Проклятье жжёт ${char.name}: —${char.curse.lastTick} HP`, 'skill');
      this.renderer.float(`🩻 —${char.curse.lastTick}`, side, 'damage');
      char.curse.lastTick = 0;
    }
  }

  _logPlagueTick(char, side){
    if(char.plagueLastTick > 0){
      this.renderer.log(`🦠 Чума ×${char.plagueStacks+1}: ${char.name} —${char.plagueLastTick} HP`, 'skill');
      this.renderer.float(`🦠 —${char.plagueLastTick}`, side, 'damage');
      char.plagueLastTick = 0;
    }
  }

  _logRevived(side){
    const char = side === 'player' ? this.player : this.ai;
    this.renderer.log(`💫 БЕССМЕРТИЕ! ${char.name} воскресает с ${char.hp} HP!`, 'crit');
    this.renderer.float(`💫 ВОСКРЕС!`, side, 'skill');
  }

  _endAiTurn(){
    if(this.player.stunTurns > 0){
      this.player.stunTurns--;
      this.renderer.log(`💤 Вы оглушены! Пропускаете ход (осталось ${this.player.stunTurns})`, 'stun');
      this.renderer.renderPanel('player', this.player);
      this.player.onTurnEnd();
      this.turnCount++;
      this.renderer.updateTurnUI();
      this._usedSkillsThisTurn.clear();
      setTimeout(()=>this._startAiTurn(), 800);
      return;
    }
    this.playerTurn = true; this.animating = false;
    this._usedSkillsThisTurn.clear();
    this.renderer.render();
    this.renderer.log('🎮 Ваш ход!', 'player');
  }

  _broadcastResults(results, side){
    const aSide = side;
    const dSide = side==='player' ? 'ai' : 'player';
    const aName = side==='player' ? this.player.name : this.ai.name;
    const dName = side==='player' ? this.ai.name     : this.player.name;

    for(const r of results){
      switch(r.effect){
        case 'damage':
          if(r.dodged){
            this.renderer.log(`💨 ${dName} уклонился!`, 'dodge');
            this.renderer.float('УКЛОН!', dSide, 'dodge');
            SFX.play('dodge');
          } else if(r.reflected > 0 && r.value === 0){
            this.renderer.log(`🪞 ${dName} отразил весь урон!`, 'armor');
            this.renderer.float(`🪞 ОТРАЖЕНО`, dSide, 'armor');
            SFX.play('reflect');
          } else if(r.blocked && r.counter){
            this.renderer.log(`⚔️ ${dName} контратакует! —${r.counterDamage} ${aName}`, 'crit');
            this.renderer.float(`⚔️ КОНТРА`, dSide, 'armor');
            if(r.counterDamage > 0) this.renderer.float(`⚔️ —${r.counterDamage}`, aSide, 'damage');
            SFX.play('counter');
          } else if(r.blocked){
            this.renderer.log(`🛡️ ${dName} заблокировал! —${r.value}`, 'block');
            this.renderer.float(`🛡️ —${r.value}`, dSide, 'block');
            SFX.play('block');
          } else {
            const cs = r.crit ? ' ⚡КРИТ!' : '';
            this.renderer.log(`⚔️ ${aName} → ${r.value} урона${cs}`, r.crit?'crit':'damage');
            this.renderer.float(`${r.crit?'💥':'⚔️'} —${r.value}`, dSide, r.crit?'crit':'damage');
            SFX.play(r.crit ? 'crit' : 'damage');
          }
          if(r.shielded > 0){
            this.renderer.log(`🔮 Щит маны поглотил ${r.shielded}`, 'mana');
            this.renderer.float(`🔮 −${r.shielded}`, dSide, 'mana');
            SFX.play('mana');
          }
          if(r.reflected > 0){
            this.renderer.log(`🪞 Урон отражён обратно! —${r.reflected} по ${aName}!`, 'skill');
            this.renderer.float(`🪞 —${r.reflected}`, aSide, 'damage');
          }
          if(r.vampHeal > 0){
            this.renderer.log(`🩸 Кровопийца: +${r.vampHeal} HP`, 'heal');
            setTimeout(()=>this.renderer.float(`🩸 +${r.vampHeal}`, aSide, 'heal'), 300);
            SFX.play('heal');
          }
          if(r.plagueApplied){
            const defChar = dSide==='ai' ? this.ai : this.player;
            this.renderer.log(`🦠 Чума! ${dName} ×${defChar.plagueStacks} стак (5 ходов)`, 'skill');
            this.renderer.float(`🦠×${defChar.plagueStacks}`, dSide, 'skill');
            SFX.play('curse');
          }
          if(r.revived){
            setTimeout(()=>this._logRevived(dSide), 400);
            SFX.play('revive');
            this._showReviveState(dSide, 2000);
          }
          if(r.lastStand){
            this.renderer.log(`🏰 ${dName} спас "Последний рубеж"!`, 'skill');
            this.renderer.float(`🏰 ВЫЖИЛ`, dSide, 'skill');
            SFX.play('revive');
            this._showReviveState(dSide, 2000);
          }
          break;

        case 'heal':
          this.renderer.log(`💚 ${aName} +${r.value} HP`, 'heal');
          this.renderer.float(`💚 +${r.value}`, aSide, 'heal');
          SFX.play('heal');
          if(r.overhealDmg > 0){
            this.renderer.log(`💫 Переизбыток → ${r.overhealDmg} урона ${dName}!`, 'crit');
            setTimeout(()=>this.renderer.float(`💫 —${r.overhealDmg}`, dSide, 'damage'), 350);
            SFX.play('damage');
          }
          break;

        case 'mana':
          this.renderer.log(`💙 ${aName} +${r.value} маны`, 'mana');
          this.renderer.float(`💙 +${r.value}`, aSide, 'mana');
          SFX.play('mana');
          if(r.maxManaBonus > 0){
            this.renderer.log(`🌀 Переполнение: макс. мана +${r.maxManaBonus}`, 'mana');
          }
          break;

        case 'armor':
          this.renderer.log(`🛡️ ${aName} +${r.value} брони`, 'armor');
          this.renderer.float(`🛡️ +${r.value}`, aSide, 'armor');
          SFX.play('armor');
          break;
      }
    }
  }

  _endGame(playerWon){
    this.animating = false; this.playerTurn = false;
    const loserSide = playerWon ? 'ai' : 'player';
    this.renderer.log(playerWon ? '⚔️ Враг повержен!' : '💀 Герой пал в бою…', playerWon?'player':'ai');
    SFX.play(playerWon ? 'victory' : 'defeat');
    this._showDeathState(loserSide);
    this._deathTimeout = setTimeout(()=>{
      this._hideDeathState(loserSide);
      this.renderer.showGameOver(playerWon, this.turnCount);
    }, 5000);
  }

  restart(){
    if(this.mp){ this.mp.close(); this.mp = null; }
    this.renderer.hideGameOver();
    this._hideDeathState('player');
    this._hideDeathState('ai');
    clearTimeout(this._deathTimeout);
    this._selectedClass = null;
    this.mode   = 'ai';
    this.myRole = null;
    this.renderer = new UIRenderer(this);
    document.getElementById('app').style.display = 'none';
    document.querySelectorAll('.cs-card').forEach(c=>c.classList.remove('selected'));
    const btn = document.getElementById('cs-start-btn');
    if(btn) btn.disabled = true;
    this._showModeSelect();
  }

  exitToMenu(){
    if(this.mp){ this.mp.close(); this.mp = null; }
    this.renderer.hideGameOver();
    this._hideDeathState('player');
    this._hideDeathState('ai');
    clearTimeout(this._deathTimeout);
    this._selectedClass = null;
    this.mode   = 'ai';
    this.myRole = null;
    document.getElementById('app').style.display = 'none';
    this._showModeSelect();
  }

  _showDeathState(side){
    const panel = document.getElementById(`${side}-panel`);
    if(!panel) return;
    panel.classList.add('dying');
  }

  _hideDeathState(side){
    const panel = document.getElementById(`${side}-panel`);
    if(!panel) return;
    panel.classList.remove('dying');
  }

  _showReviveState(side, durationMs = 2000){
    const panel = document.getElementById(`${side}-panel`);
    if(!panel) return;
    panel.classList.add('reviving');
    setTimeout(()=>{
      panel.classList.remove('reviving');
    }, durationMs);
  }
}

/* ── Bootstrap ──────────────────────────────────── */
let game;
window.addEventListener('DOMContentLoaded', ()=>{ game = new Game(); });