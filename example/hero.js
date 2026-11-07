// Match 3 Game PvP

const hero = {
    userName: "",  

    // Счетчик ходов для отслеживания длительности эффектов и перезарядки навыков
    turnCount: 0,

    // Флаг, указывающий, является ли сейчас ходом героя
    itsMyTurn: false,

    comboCounter: 0, // Счетчик для отслеживания количества последовательных ударов в комбо

    currentGemType: null, // Текущий тип гема / руны

    currentGems: 0, // Текущее количество одинаковых гемов в комбинации

    effects: {
        buffs: [
            { skillName: '', timer: 0 }
        ],

        debuffs: [
            { skillName: '', timer: 0 }
        ],
    },

    classStats: currentClass,
}

const currentClass = {
    className: "",

    assets: {
        icon: "", // URL или путь к иконке класса
    },

    description: {
        uk: "", 
        ru: "",
        en: "",
    },

    stats: {

        // Базовые значения характеристики в начале боя
        defaultValue: {
            maxHp: 1000,
            maxMp: 500,
            attack: 100,
            armor: 50,
        },

        // Значения могут меняться под действием эффектов и навыков
        currentValue: {
            maxHp: 1000,
            maxMp: 500,
            currentHp: 1000,
            currentMp: 500,
            attack: 100,
            armor: 50,
        }
    },

    skills: {
        passiveSkills: ['skill name'],
        activeSkills: ['skill name'],
    },
}


const skill = {
    name: "",

    description: {
        uk: "",
        ru: "",
        en: "",
    },

    assets: {
        icon: "",
        animation: "",
        sound: "",
    },

    type: "active", // "active" или "passive"    
    target: "enemy",  // "self", "ally", "enemy"       
    isPositive: true,         
    
    // Стаки и их поведение
    stacking: {
        isStackable: false,
        maxStacks: 5,
        refreshDurationOnStack: true, // Обновлять ли длительность (effectDuration) при новом стаке
        scalingFactor: 1.2,           // Множитель (множит эффект на 1.2 за каждый стак или уменьшение например 0.8 за каждый стак)
    },

    // Тайминги
    cooldown: 0,        
    effectDuration: 0,  

    // Стоимость
    cost: {
        mp: 0, 
        hp: 0,
        armor: 0,
        comboCounter: 0, 
    },

    // Счетчики использования (Counters)
    usage: {
        totalPerBattle: 0,    // Всего за бой
        currentTurn: 0,       // За текущий ход (сбрасывается после хода игрока)
        limitPerBattle: null, // Лимит на бой (если есть)
        limitPerTurn: 1,      // Лимит на ход (например, нельзя юзать дважды за ход)
    },

    // Динамические показатели (Modifiers)
    modifiers: {
        baseValue: 10,        // Базовое значение (урон/хил)
        growthPerStack: 5,    // На сколько увеличивается эффект с каждым применением
    }
}


