/**
 * ==========================================
 * CONFIGURATION（設定項目）
 * ==========================================
 */
const CONFIG = {
    // --- 画面設定 ---
    bgColor: '#050508',        // 背景色
    logicalWidth: 1920,         // ゲーム内の論理的な横幅（描画の基準）
    logicalHeight: 1080,        // ゲーム内の論理的な縦幅

    // --- ブロックの設定 ---
    blockWidth: 60,             // ブロック1つの横幅
    blockHeight: 30,            // ブロック1つの縦幅
    blockPadding: 8,            // ブロック同士の隙間
    blockRows: 22,              // 配置するブロックの行数（増やすと1ステージが長くなります）

    // --- 生命体（LifeForm）の基本設定 ---
    lifeCount: 5,               // ゲーム開始時の生命体の数
    lifeBaseSize: 8,            // 生命体の基本半径（Lv.1の時の大きさ）
    
    // --- 演出（残像・エフェクト） ---
    lifeTrailDensity: 4,        // 残像の密度（増やすと軌跡が濃くなりますが重くなります）
    lifeTrailLife: 12,          // 残像が消えるまでの時間（フレーム数）
    particleCount: 20,          // ブロック破壊時の火花の数
    particleLife: 40,           // 火花が消えるまでの時間

    // --- 成長・バランス調整 ---
    baseExpToLevel: 10,          // Lv.1からLv.2に上がるために必要な経験値（叩く回数）
    expMultiplier: 1.2,         // レベルアップごとの必要経験値の増加倍率
    hpMultiplier: 10,           // ステージ進行によるブロックHPの増加倍率（高いほど敵が硬くなります）
    
    // --- 移動速度設定 ---
    lifeBaseSpeed: 3,           // 生命体の初期移動速度
    lifeMaxSpeed: 12,           // アップグレードによる移動速度の限界値
};

/**
 * AUDIO MANAGER
 * 音の重なりや再生頻度を管理
 */
class AudioManager {
    constructor() {
        this.hitSoundPath = './sounds/impact_crystal.mp3';
        this.destroySoundPath = './sounds/fragment_shatter.mp3';
        this.evoSoundPath = './sounds/anima_evolution.mp3';
        this.upgradeSoundPath = './sounds/upgrade.mp3';

        this.hitPool = this.createPool(this.hitSoundPath, 15);
        this.destroyPool = this.createPool(this.destroySoundPath, 5);
        this.evoPool = this.createPool(this.evoSoundPath, 3);
        this.upgradePool = this.createPool(this.upgradeSoundPath, 3);

        this.hitIndex = 0; 
        this.destroyIndex = 0; 
        this.evoIndex = 0;
        this.upgradeIndex = 0;
        
        this.lastPlayTime = 0; 
        this.minInterval = 50; 
    }

    createPool(path, size) {
        const pool = [];
        for (let i = 0; i < size; i++) {
            const audio = new Audio(path); 
            audio.load(); 
            pool.push(audio);
        }
        return pool;
    }

    play(type, volume = 0.2) {
        const now = Date.now();
        let targetPool, targetIndex;

        if (type === 'hit') {
            if (now - this.lastPlayTime < this.minInterval) return;
            targetPool = this.hitPool; targetIndex = this.hitIndex;
            this.hitIndex = (this.hitIndex + 1) % this.hitPool.length;
            this.lastPlayTime = now;
        } else if (type === 'destroy') {
            targetPool = this.destroyPool; targetIndex = this.destroyIndex;
            this.destroyIndex = (this.destroyIndex + 1) % this.destroyPool.length;
        } else if (type === 'evolution') {
            targetPool = this.evoPool; targetIndex = this.evoIndex;
            this.evoIndex = (this.evoIndex + 1) % this.evoPool.length;
        } else if (type === 'upgrade') {
            targetPool = this.upgradePool; targetIndex = this.upgradeIndex;
            this.upgradeIndex = (this.upgradeIndex + 1) % this.upgradePool.length;
        }

        if (targetPool) {
            const audio = targetPool[targetIndex];
            audio.volume = volume; 
            audio.currentTime = 0; 
            audio.play().catch(()=>{});
        }
    }
}
const audio = new AudioManager();

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        this.isStarted = false;
        this.stage = 1;
        this.blocks = [];
        this.lifeForms = [];
        this.effects = [];
        this.auraRotation = 0;
        this.isClearing = false;
        this.clearTimer = 0;

        this.scale = 1; this.offsetX = 0; this.offsetY = 0;

        this.stats = {
            destroyedBlocks: 0, totalHits: 0, totalDamage: 0,
            startTime: Date.now(), accumulatedTime: 0, damageHistory: [], initialTotalHp: 0  
        };

        // グローバルステータスのデフォルト値
        this.globalStats = {
            attack:  { lv: 1, val: 1, max: 20, step: 1, name: "ATTACK_POWER" },
            speed:   { lv: 1, val: 2.8, max: 10, step: 0.6, name: "MVMT_SPEED" },
            agility: { lv: 1, val: 0.07, max: 15, step: 0.012, name: "TURN_AGILITY" },
            maxLife: { lv: 1, val: 5, max: 10, step: 1, name: "MAX_FRAGMENTS" } 
        };

        // ポイント管理のデフォルト値
        this.upgradePoints = 0;
        this.maxLevelRecord = 1; 
        this.hasNewPoints = false;

        // ロードゲーム
        this.loadGame();

        this.resize();
        this.checkScreenSize();
        window.addEventListener('resize', () => { this.resize(); this.checkScreenSize(); });

        // スタート画面イベント
        const startScreen = document.getElementById('startScreen');
        startScreen.addEventListener('click', (e) => {
            // モーダルやボタンへのクリックが伝播しないようにする
            if (e.target.closest('#upgradeBtn') || e.target.closest('#upgradeModal')) return;
            if (!this.isStarted) {
                this.isStarted = true;
                this.stats.startTime = Date.now();
                new Audio().play().catch(()=>{}); 
                startScreen.style.display = 'none';
                
                // ゲーム開始時にアップグレードボタンを表示
                document.getElementById('upgradeBtn').style.display = 'block';
                this.loop();
            }
        });

        this.setupUI();

        this.initStage();

        if (this.lifeForms.length === 0) {
            this.spawnLifeForms();
        }

        this.drawInitialFrame();
    }

    setupUI() {
        const btn = document.getElementById('upgradeBtn');
        const modal = document.getElementById('upgradeModal');
        const close = document.getElementById('closeModal');
        const resetBtn = document.getElementById('resetBtn');
        const prestigeBtn = document.getElementById('prestigeBtn');

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.updateUpgradeList();
            modal.style.display = 'flex';
            
            this.hasNewPoints = false;
            const badge = document.getElementById('notifyBadge');
            if (badge) badge.style.display = 'none';
        });

        close.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        window.addEventListener('mousedown', (e) => {
            if (modal.style.display === 'flex' && e.target === modal) {
                modal.style.display = 'none';
            }
        });

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetGame();
            });
        }

        if (prestigeBtn) {
            prestigeBtn.addEventListener('click', () => {
                this.prestigeGame();
            });
        }
    }

    getUpgradeCost(key) {
        return this.globalStats[key].lv; 
    }

    // アップグレード画面の描画更新
    updateUpgradeList() {
        const list = document.getElementById('upgradeList');
        const pointDisp = document.getElementById('pointDisplay');
        const badge = document.getElementById('notifyBadge');
        
        pointDisp.textContent = this.upgradePoints;
        
        if (badge) {
            badge.style.display = this.hasNewPoints ? 'block' : 'none';
        }

        list.innerHTML = '';

        Object.keys(this.globalStats).forEach(key => {
            const s = this.globalStats[key];
            const isMax = s.lv >= s.max;
            const cost = this.getUpgradeCost(key);
            const canAfford = this.upgradePoints >= cost;
            
            const currentDisplay = Number.isInteger(s.val) ? s.val : s.val.toFixed(2);
            const nextVal = isMax ? s.val : (s.val + s.step);
            const nextDisplay = Number.isInteger(nextVal) ? nextVal : nextVal.toFixed(2);

            const row = document.createElement('div');
            row.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: rgba(0, 200, 255, 0.05); padding: 10px; border: 1px solid rgba(0, 200, 255, 0.2); margin-bottom: 5px;";
            
            row.innerHTML = `
                <div>
                    <div style="color: #0ff; font-weight: bold; font-size: 16px;">${s.name} <span style="font-size:12px; color:#aaa;">LV.${s.lv}</span></div>
                    <div style="font-size: 12px; color: #888; margin-top: 4px;">
                        CUR: <span style="color:#fff;">${currentDisplay}</span> 
                        ${isMax ? '<span style="color:#f00;">(MAX)</span>' : `→ NEXT: <span style="color:#0f0;">${nextDisplay}</span>`}
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 10px; color: ${canAfford ? '#0f0' : '#f44'}; margin-bottom: 4px;">
                        ${isMax ? '-' : `COST: ${cost} PT`}
                    </div>
                    <button id="btn-${key}" ${isMax || !canAfford ? 'disabled' : ''} style="
                        background: ${isMax ? '#333' : (canAfford ? 'rgba(0, 200, 255, 0.2)' : '#222')};
                        color: ${isMax ? '#666' : (canAfford ? '#0ff' : '#555')};
                        border: 1px solid ${isMax ? '#444' : (canAfford ? '#0ff' : '#444')};
                        padding: 5px 15px; cursor: ${canAfford && !isMax ? 'pointer' : 'not-allowed'};
                        font-family: inherit; font-size: 12px; min-width: 80px;
                    ">
                        ${isMax ? 'MAX' : 'UPGRADE'}
                    </button>
                </div>
            `;

            list.appendChild(row);

            if (!isMax && canAfford) {
                const upgradeBtn = row.querySelector(`#btn-${key}`);
                upgradeBtn.onclick = () => this.purchaseUpgrade(key);
            }
        });

        const prestigeBtn = document.getElementById('prestigeBtn');
        if (prestigeBtn) {
            if (this.stage < 30) {
                prestigeBtn.disabled = true;
                prestigeBtn.style.opacity = '0.3';
                prestigeBtn.style.cursor = 'not-allowed';
                prestigeBtn.innerText = '[ PRESTIGE: PH30 REQ ]';
            } else {
                prestigeBtn.disabled = false;
                prestigeBtn.style.opacity = '1';
                prestigeBtn.style.cursor = 'pointer';
                prestigeBtn.innerText = '[ PRESTIGE ]';
            }
        }
    }

    purchaseUpgrade(key) {
        const cost = this.getUpgradeCost(key);
        if (this.upgradePoints >= cost) {
            const s = this.globalStats[key];
            if (s.lv < s.max) {
                this.upgradePoints -= cost;
                s.lv++;
                s.val += s.step;

                if (key === 'maxLife') {
                    const newLife = new LifeForm(this.canvas.width / 2, this.canvas.height / 2);
                    this.lifeForms.push(newLife);
                }

                this.updateUpgradeList();

                audio.play('upgrade', 0.5);

                this.saveGame();
            }
        }
    }

    checkProgression() {
        const currentMax = this.lifeForms.reduce((max, lf) => Math.max(max, lf.level), 0);
        if (currentMax > this.maxLevelRecord) {
            const gain = currentMax - this.maxLevelRecord;
            this.upgradePoints += gain;
            this.maxLevelRecord = currentMax;
            
            const modal = document.getElementById('upgradeModal');
            const isModalOpen = modal && modal.style.display === 'flex';

            if (isModalOpen) {
                // ウィンドウが開いているなら、リアルタイムでリストだけ更新（通知は出さない）
                this.updateUpgradeList();
            } else {
                // ウィンドウが閉じている時にポイントが入ったら通知フラグを立てる
                this.hasNewPoints = true;
                const badge = document.getElementById('notifyBadge');
                if (badge) badge.style.display = 'block';
            }
        }
    }

    checkScreenSize() {
        const warningEl = document.getElementById('sizeWarning');
        if (!warningEl) return;
        const sw = window.innerWidth; const sh = window.innerHeight;
        const isLowRes = sw < 1000 || sh < 600;
        if (isLowRes) {
            warningEl.innerHTML = `<div class="warning-box"><span style="color: #ff4444; font-weight: bold;">[ SYSTEM WARNING ]</span><br><span style="color: #fff; opacity: 0.9; font-size: 11px;">LOW RESOLUTION: ${sw}x${sh}<br>RECOMMENDED: 1280x720 OR HIGHER</span></div>`;
        } else {
            warningEl.innerHTML = `<div style="color: rgba(0, 200, 255, 0.4); margin-top: 15px;">RESOLUTION: ${sw}x${sh} [ OK ]<br>SYSTEM CALIBRATION COMPLETE</div>`;
        }
    }

    start() {
        this.isStarted = true;
        this.stats.startTime = Date.now();
        
        // ダミー再生でブラウザの音声ロックを解除
        const silentAudio = new Audio();
        silentAudio.play().catch(()=>{});
        
        // ループ開始
        this.loop();
    }

    drawInitialFrame() {
        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);
        this.ctx.fillStyle = CONFIG.bgColor;
        this.ctx.fillRect(0, 0, CONFIG.logicalWidth, CONFIG.logicalHeight);
        this.drawAura();
        this.blocks.forEach(b => b.draw(this.ctx));
        this.ctx.restore();
    }

    resize() {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const scaleX = screenW / CONFIG.logicalWidth;
        const scaleY = screenH / CONFIG.logicalHeight;
        
        // アスペクト比を維持してフィットさせる
        this.scale = Math.min(scaleX, scaleY);
        this.offsetX = (screenW - CONFIG.logicalWidth * this.scale) / 2;
        this.offsetY = (screenH - CONFIG.logicalHeight * this.scale) / 2;

        this.canvas.width = screenW;
        this.canvas.height = screenH;
    }

    initStage() {
        this.blocks = [];
        const cols = Math.floor(CONFIG.logicalWidth / (CONFIG.blockWidth + CONFIG.blockPadding)) - 2;
        const offsetX = (CONFIG.logicalWidth - (cols * (CONFIG.blockWidth + CONFIG.blockPadding))) / 2;
        let totalHp = 0;
        
        const seedA = Math.random() * 2 + 0.2;
        const seedB = Math.random() * 2 + 0.2;
        const threshold = Math.random() * 0.4 - 0.2;
        const safeZoneHeight = 400; 
        const centerY = CONFIG.logicalHeight / 2;

        for (let r = 0; r < CONFIG.blockRows; r++) {
            const y = 120 + r * (CONFIG.blockHeight + CONFIG.blockPadding);
            if (y > CONFIG.logicalHeight - 100) continue;
            // 中央のUIエリアには配置しない
            if (y > centerY - (safeZoneHeight / 2) && y < centerY + (safeZoneHeight / 2)) continue;

            for (let c = 0; c < cols; c++) {
                if (Math.sin(c * seedA) + Math.cos(r * seedB) > threshold) {
                    const maxHp = this.stage * CONFIG.hpMultiplier;
                    const minHp = Math.max(1, Math.floor(maxHp * 0.5));
                    const hp = Math.floor(Math.random() * (maxHp - minHp + 1)) + minHp;
                    const x = offsetX + c * (CONFIG.blockWidth + CONFIG.blockPadding);
                    this.blocks.push(new Block(x, y, hp));
                    totalHp += hp;
                }
            }
        }
        this.stats.initialTotalHp = totalHp;
    }

    spawnLifeForms() {
        this.lifeForms = [];
        for (let i = 0; i < CONFIG.lifeCount; i++) {
            this.lifeForms.push(new LifeForm(CONFIG.logicalWidth / 2, CONFIG.logicalHeight / 2));
        }
    }

    updateDPS(damage) {
        this.stats.totalDamage += damage;
        this.stats.totalHits++;
        this.stats.damageHistory.push({ t: Date.now(), d: damage });
    }

    getAverageDPS() {
        const now = Date.now();
        this.stats.damageHistory.push({ t: now, d: 0 }); // ダミー挿入で時間管理
        this.stats.damageHistory = this.stats.damageHistory.filter(h => now - h.t < 1000);
        return this.stats.damageHistory.reduce((s, h) => s + h.d, 0);
    }

    loop() {
        if (!this.isStarted) return;
        
        this.checkProgression();

        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.fillStyle = CONFIG.bgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);

        this.drawAura();
        this.drawUI();

        // --- クリア演出の処理ここから ---
        if (this.isClearing) {
            this.clearTimer--;
            
            // 演出が始まった瞬間、HTML UIを強制的に非表示にする
            const upgradeBtn = document.getElementById('upgradeBtn');
            const upgradeModal = document.getElementById('upgradeModal');
            if (upgradeBtn) upgradeBtn.style.display = 'none';      // ボタンを隠す
            if (upgradeModal) upgradeModal.style.display = 'none';  // ウィンドウを閉じる

            // 演出エフェクト
            if (this.clearTimer % 10 === 0) {
                this.createExplosion(
                    CONFIG.logicalWidth / 2 + (Math.random() - 0.5) * 400,
                    CONFIG.logicalHeight / 2 + (Math.random() - 0.5) * 400,
                    '#0ff'
                );
            }

            if (this.clearTimer <= 0) {
                this.isClearing = false;
                this.stage++;
                this.saveGame();
                this.initStage();
                this.lifeForms.forEach(lf => {
                    lf.x = CONFIG.logicalWidth / 2;
                    lf.y = CONFIG.logicalHeight / 2;
                    lf.currentTarget = null;
                });

                // 演出終了後、ポイントがあればボタンを再表示させる
                if (this.upgradePoints > 0 || this.maxLevelRecord > 0) {
                    const upgradeBtn = document.getElementById('upgradeBtn');
                    if (upgradeBtn) upgradeBtn.style.display = 'inline-block';
                }
            }
        } else {
            // 通常時：ブロックが全滅した瞬間にクリア演出を開始
            if (this.blocks.length === 0) {
                this.isClearing = true;
                this.clearTimer = 120;
            }
        }
        // --- クリア演出の処理ここまで ---

        // ブロック処理（演出中も描画は続ける）
        for (let i = this.blocks.length - 1; i >= 0; i--) {
            const block = this.blocks[i];
            if (block.isDead) {
                this.stats.destroyedBlocks++;
                this.createExplosion(block.x + block.w/2, block.y + block.h/2, block.color);
                this.blocks.splice(i, 1);
            } else {
                block.draw(this.ctx);
            }
        }

        // 生命体処理（演出中は update を止めることで静止させる）
        this.lifeForms.forEach(lf => {
            if (!this.isClearing) {
                const damageDealt = lf.update(this.blocks, CONFIG.logicalWidth, CONFIG.logicalHeight, this.globalStats);
                if (damageDealt > 0) this.updateDPS(damageDealt);
            }
            lf.draw(this.ctx);
        });

        // エフェクト処理（爆発などは演出中も動かす）
        for (let i = this.effects.length - 1; i >= 0; i--) {
            this.effects[i].update();
            this.effects[i].draw(this.ctx);
            if (this.effects[i].life <= 0) this.effects.splice(i, 1);
        }

        this.ctx.restore();
        requestAnimationFrame(() => this.loop());
    }

    drawAura() {
        const cx = CONFIG.logicalWidth/2, cy = CONFIG.logicalHeight/2;
        this.auraRotation += 0.002;
        this.ctx.save();
        this.ctx.translate(cx, cy);
        this.ctx.rotate(this.auraRotation);
        this.ctx.strokeStyle = 'rgba(0, 200, 255, 0.03)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        for(let i=0; i<6; i++){
            this.ctx.rotate(Math.PI/3);
            this.ctx.moveTo(300,0); this.ctx.lineTo(600,0);
        }
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.arc(0,0, 450, 0, Math.PI*2);
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawUI() {
        const centerX = CONFIG.logicalWidth / 2;
        const centerY = CONFIG.logicalHeight / 2;
        const currentTotalHp = this.blocks.reduce((sum, b) => sum + b.hp, 0);
        const progress = 1 - (currentTotalHp / this.stats.initialTotalHp || 0);
        const dps = Math.floor(this.getAverageDPS());

        // 今回のセッション時間 ＋ 過去の累計時間 を合計して秒に変換
        const totalMs = (Date.now() - this.stats.startTime) + (this.stats.accumulatedTime || 0);
        const uptimeSeconds = Math.floor(totalMs / 1000);

        const maxUnitLevel = this.maxLevelRecord;
        const totalAttack = this.lifeForms.length * this.globalStats.attack.val;

        // プログレスバー
        const barW = 400, barH = 2, barY = 50;
        this.ctx.fillStyle = '#111'; this.ctx.fillRect(centerX - barW/2, barY, barW, barH);
        this.ctx.fillStyle = '#0f0'; this.ctx.fillRect(centerX - barW/2, barY, barW * progress, barH);

        const titleY = barY + 60;
        this.ctx.textAlign = 'center'; this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        this.ctx.font = 'bold 32px "Courier New", monospace';
        this.ctx.fillText("ANIMA FRAGMENT", centerX, titleY);

        const phaseY = centerY - 80; 
        this.ctx.fillStyle = 'rgba(0, 200, 255, 0.1)';
        this.ctx.font = 'bold 85px "Courier New", monospace';
        this.ctx.fillText(`PHASE:${this.stage.toLocaleString()}`, centerX, phaseY);

        this.ctx.font = '16px "Courier New", monospace';
        const statsLineY = phaseY + 40;
        const spacing = 28;
        const data = [
            [this.lifeForms.length.toLocaleString(), "UNITS_ACTIVE"],
            [this.stats.destroyedBlocks.toLocaleString(), "BLOCKS_DESTROYED"],
            [this.stats.totalHits.toLocaleString(), "CONTACT_HITS"],
            [dps.toLocaleString() + "/s", "DAMAGE_PER_SEC"],
            [totalAttack.toLocaleString(), "TOTAL_ATTACK_PWR"],
            ["LV." + maxUnitLevel.toLocaleString(), "MAX_UNIT_LEVEL"],
            [this.formatTime(uptimeSeconds), "SYSTEM_UPTIME"]
        ];

        data.forEach((item, i) => {
            const y = statsLineY + (i * spacing);
            this.ctx.textAlign = 'right'; this.ctx.fillStyle = '#fff';
            this.ctx.fillText(item[0], centerX - 12, y);
            this.ctx.textAlign = 'center'; this.ctx.fillStyle = 'rgba(0, 200, 255, 0.5)';
            this.ctx.fillText(":", centerX, y);
            this.ctx.textAlign = 'left'; this.ctx.fillStyle = 'rgba(0, 200, 255, 0.7)';
            this.ctx.fillText(item[1], centerX + 12, y);
        });

        // --- ボタンの位置調整と再表示制御 ---
        const upgradeBtn = document.getElementById('upgradeBtn');
        if (upgradeBtn) {
            if (this.isClearing) {
                upgradeBtn.style.display = 'none';
            } else {
                const shouldShow = this.upgradePoints > 0 || this.maxLevelRecord > 0;
                
                if (shouldShow) {
                    if (upgradeBtn.style.display === 'none') {
                        upgradeBtn.style.display = 'inline-block';
                    }

                    const rect = this.canvas.getBoundingClientRect();
                    const scaleX = rect.width / CONFIG.logicalWidth;
                    const scaleY = rect.height / CONFIG.logicalHeight;
                    const lastLineY = statsLineY + (data.length - 1) * spacing;
                    const btnY = lastLineY + 30;
                    
                    upgradeBtn.style.left = `${rect.left + centerX * scaleX}px`;
                    upgradeBtn.style.top = `${rect.top + btnY * scaleY}px`;
                    upgradeBtn.style.transform = `translate(-50%, 0) scale(${scaleY * 1.4})`;
                }
            }
        }

        // --- ステージクリア演出描画 ---
        if (this.isClearing) {
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            this.ctx.fillRect(0, 0, CONFIG.logicalWidth, CONFIG.logicalHeight);

            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            
            const pulse = Math.sin(this.clearTimer * 0.1) * 5;
            this.ctx.font = `bold ${70 + pulse}px "Courier New", monospace`;
            this.ctx.fillStyle = '#0ff';
            this.ctx.shadowBlur = 15;
            this.ctx.shadowColor = '#0ff';
            this.ctx.fillText("PHASE COMPLETE", centerX, centerY);
            
            this.ctx.font = '20px "Courier New", monospace';
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            this.ctx.shadowBlur = 0;
            this.ctx.fillText("INITIALIZING NEXT DATA SECTOR...", centerX, centerY + 80);
            this.ctx.restore();
        }
    }

    formatTime(s) {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) {
            return `${h}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
        }
        return `${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
    }

    createExplosion(x, y, color) {
        for(let i=0; i<CONFIG.particleCount; i++){
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 3 + 1;
            this.effects.push(new Particle(x, y, Math.cos(angle)*speed, Math.sin(angle)*speed, color));
        }
    }

    // --- セーブ＆ロード機能 ---
    saveGame() {
        try {
            // 今回のセッションでの経過時間を計算
            const sessionTime = Date.now() - this.stats.startTime;

            const saveData = {
                stage: this.stage,
                upgradePoints: this.upgradePoints,
                maxLevelRecord: this.maxLevelRecord,
                globalStats: this.globalStats,
                lifeFormLevels: this.lifeForms.map(lf => lf.level),
                // 統計情報の保存
                stats: {
                    destroyedBlocks: this.stats.destroyedBlocks,
                    totalHits: this.stats.totalHits,
                    totalDamage: this.stats.totalDamage,
                    // 過去の累計に今回の分を足して保存
                    accumulatedTime: (this.stats.accumulatedTime || 0) + sessionTime
                },
                timestamp: Date.now()
            };
            localStorage.setItem('anima_fragment_save', JSON.stringify(saveData));
            console.log("SYSTEM_DATA_SYNCED: Phase " + this.stage);
        } catch (e) {
            console.error("SAVE_FAILED", e);
        }
    }

    loadGame() {
        const rawData = localStorage.getItem('anima_fragment_save');
        if (!rawData) return false;

        try {
            const saved = JSON.parse(rawData);
            this.stage = saved.stage || 1;
            this.upgradePoints = saved.upgradePoints || 0;
            this.maxLevelRecord = saved.maxLevelRecord || 1;
            if (saved.globalStats) this.globalStats = saved.globalStats;

            // 統計情報の復元
            if (saved.stats) {
                this.stats.destroyedBlocks = saved.stats.destroyedBlocks || 0;
                this.stats.totalHits = saved.stats.totalHits || 0;
                this.stats.totalDamage = saved.stats.totalDamage || 0;
                this.stats.accumulatedTime = saved.stats.accumulatedTime || 0;
                // ロードした瞬間を新しい開始時刻にする
                this.stats.startTime = Date.now();
            }

            if (saved.lifeFormLevels && saved.lifeFormLevels.length > 0) {
                this.lifeForms = [];
                saved.lifeFormLevels.forEach(level => {
                    const lf = new LifeForm(CONFIG.logicalWidth / 2, CONFIG.logicalHeight / 2);
                    lf.syncLevel(level);
                    this.lifeForms.push(lf);
                });
            }

            if (this.lifeForms.length > 0) {
                const actualMax = Math.max(...this.lifeForms.map(lf => lf.level));
                this.maxLevelRecord = Math.max(this.maxLevelRecord, actualMax);
            }

            this.updateUpgradeList();
            console.log("SYSTEM_DATA_RESTORED: MAX_LVL=" + this.maxLevelRecord);
            return true;
        } catch (e) {
            console.error("LOAD_FAILED", e);
            return false;
        }
    }

    resetGame() {
        const firstCheck = confirm("【警告】すべてのフラグメント記録とアップグレードを破棄しますか？");
        if (firstCheck) {
            const secondCheck = confirm("本当によろしいですか？この操作は取り消せません。システムが初期状態に再起動されます。");
            if (secondCheck) {
                localStorage.removeItem('anima_fragment_save');
                location.reload();
            }
        }
    }

    prestigeGame() {
        if (this.stage < 30) {
            alert(`[アクセス拒否]\nSYSTEM_EVOLUTIONを実行するには PHASE 30 への到達が必要です。\n(現在のPHASE: ${this.stage})`);
            return;
        }

        const rewardPoints = Math.max(0, this.stage - 1);
        const carryOverPoints = this.upgradePoints;
        const totalPointsAfter = carryOverPoints + rewardPoints;
        
        const firstCheck = confirm(
            `【システム進化：PRESTIGE実行】\n\n` +
            `到達PHASE: ${this.stage}\n` +
            `--------------------------\n` +
            `・進化報酬    : + ${rewardPoints} pt\n` +
            `・未消費分    : + ${carryOverPoints} pt\n` +
            `・次世代所持  :   ${totalPointsAfter} pt\n` +
            `--------------------------\n` +
            `現在の個体をアーカイブし、システムを進化させて再起動しますか？`
        );

        if (firstCheck) {
            const secondCheck = confirm(
                "最終確認：本当によろしいですか？\n" +
                "アップグレード記録とシステム時間は初期化されますが、\n" +
                `合計 ${totalPointsAfter} pt を持って PHASE 1 から ASCEND（上昇）します。`
            );

            if (secondCheck) {
                const prestigeSave = {
                    prestigeCount: (this.prestigeCount || 0) + 1,
                    stage: 1,
                    upgradePoints: totalPointsAfter,
                    maxLevelRecord: 1,
                    
                    globalStats: {
                        attack:  { lv: 1, val: 1, max: 20, step: 1, name: "ATTACK_POWER" },
                        speed:   { lv: 1, val: 2.8, max: 10, step: 0.6, name: "MVMT_SPEED" },
                        agility: { lv: 1, val: 0.07, max: 15, step: 0.012, name: "TURN_AGILITY" },
                        maxLife: { lv: 1, val: 5, max: 10, step: 1, name: "MAX_FRAGMENTS" }
                    },
                    
                    lifeFormLevels: [1, 1, 1, 1, 1],
                    
                    stats: {
                        destroyedBlocks: 0,
                        totalHits: 0,
                        totalDamage: 0,
                        startTime: Date.now(),
                        accumulatedTime: 0 
                    },
                    timestamp: Date.now()
                };

                localStorage.setItem('anima_fragment_save', JSON.stringify(prestigeSave));
                location.reload();
            }
        }
    }
}

class Block {
    constructor(x, y, hp) {
        this.x = x; this.y = y; this.w = CONFIG.blockWidth; this.h = CONFIG.blockHeight;
        this.hp = hp; this.isDead = false; this.color = ''; this.hitEffect = 0;
    }
    takeDamage(damage) {
        this.hp -= damage; this.hitEffect = 1.0;
        if (this.hp <= 0) { this.isDead = true; audio.play('destroy', 0.4); }
        else { audio.play('hit', 0.15); }
    }
    draw(ctx) {
        const hue = (200 + this.hp) % 360;
        this.color = `hsl(${hue}, 80%, 40%)`;
        if (this.hitEffect > 0) {
            ctx.save(); ctx.shadowBlur = 15 * this.hitEffect; ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
            ctx.strokeStyle = `rgba(255, 255, 255, ${this.hitEffect})`; ctx.lineWidth = 2;
            ctx.strokeRect(this.x - 2, this.y - 2, this.w + 4, this.h + 4); ctx.restore();
            this.hitEffect *= 0.9; if (this.hitEffect < 0.01) this.hitEffect = 0;
        }
        ctx.fillStyle = this.color; ctx.strokeStyle = `hsl(${hue}, 100%, 70%)`;
        ctx.fillRect(this.x, this.y, this.w, this.h); ctx.strokeRect(this.x, this.y, this.w, this.h);
        ctx.fillStyle = '#fff'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
        ctx.fillText(this.hp.toLocaleString(), this.x + this.w / 2, this.y + this.h / 2 + 4);
    }
}

class ExplosionParticle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4 + 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = CONFIG.particleLife;
    }
    update() { this.x += this.vx; this.y += this.vy; this.vy += 0.05; this.life--; }
    draw(ctx) {
        ctx.globalAlpha = this.life / CONFIG.particleLife;
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

class LifeForm {
    constructor(x, y) {
        this.x = x; this.y = y;
        const angle = Math.random() * Math.PI * 2;
        // 速度はGlobalStatsで決定するため、ここではベクトル計算用の一時的な値
        this.vx = Math.cos(angle);
        this.vy = Math.sin(angle);
        
        this.level = 1; 
        this.exp = 0;
        this.nextLevelExp = CONFIG.baseExpToLevel;
        this.particles = []; this.pulse = 0;
        this.currentTarget = null;
    }

    syncLevel(level) {
        this.level = level;
        this.exp = 0;

        this.nextLevelExp = Math.floor(CONFIG.baseExpToLevel * Math.pow(CONFIG.expMultiplier, this.level - 1));
    }

    getToroidalVector(targetX, targetY, screenW, screenH) {
        let dx = targetX - this.x;
        let dy = targetY - this.y;
        if (Math.abs(dx) > screenW / 2) dx = dx > 0 ? dx - screenW : dx + screenW;
        if (Math.abs(dy) > screenH / 2) dy = dy > 0 ? dy - screenH : dy + screenH;
        return { dx, dy, distSq: dx * dx + dy * dy };
    }

    update(blocks, screenW, screenH, stats) {
        this.pulse += 0.08;
        let damageDone = 0;

        const currentSpeed = stats.speed.val;
        const currentTurn = stats.agility.val;
        const currentAttack = stats.attack.val;

        // 残像の生成
        for (let i = 0; i < CONFIG.lifeTrailDensity; i++) {
            this.particles.push({
                x: this.x, y: this.y, life: CONFIG.lifeTrailLife,
                size: (CONFIG.lifeBaseSize + this.level) * (1 - i / CONFIG.lifeTrailDensity)
            });
        }
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].life--;
            if (this.particles[i].life <= 0) this.particles.splice(i, 1);
        }

        // ターゲットの選定
        if (!this.currentTarget || this.currentTarget.isDead) {
            if (blocks.length > 0) {
                let minDistSq = Infinity;
                let found = null;
                blocks.forEach(b => {
                    const vector = this.getToroidalVector(b.x + b.w / 2, b.y + b.h / 2, screenW, screenH);
                    if (vector.distSq < minDistSq) { 
                        minDistSq = vector.distSq; 
                        found = b; 
                    }
                });
                this.currentTarget = found;
            }
        }

        // 旋回ロジック
        let currentAngle = Math.atan2(this.vy, this.vx);
        if (this.currentTarget) {
            const vector = this.getToroidalVector(
                this.currentTarget.x + this.currentTarget.w / 2, 
                this.currentTarget.y + this.currentTarget.h / 2, 
                screenW, screenH
            );
            const targetAngle = Math.atan2(vector.dy, vector.dx);
            let delta = targetAngle - currentAngle;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            
            const turn = Math.max(-currentTurn, Math.min(currentTurn, delta));
            currentAngle += turn;
        }

        this.vx = Math.cos(currentAngle) * currentSpeed;
        this.vy = Math.sin(currentAngle) * currentSpeed;

        this.x += this.vx; 
        this.y += this.vy;

        if (this.x < 0) this.x += screenW; else if (this.x >= screenW) this.x -= screenW;
        if (this.y < 0) this.y += screenH; else if (this.y >= screenH) this.y -= screenH;

        // 衝突判定（位置補正付き）
        const r = CONFIG.lifeBaseSize + this.level;
        for (const b of blocks) {
            if (this.x > b.x - r && this.x < b.x + b.w + r && this.y > b.y - r && this.y < b.y + b.h + r) {
                b.takeDamage(currentAttack);
                damageDone = currentAttack;
                this.exp++;
                if (this.exp >= this.nextLevelExp) this.levelUp();
                
                // 衝突面に応じた反転と「押し出し」
                const overlapX = Math.abs(this.x - (b.x + b.w / 2)) / b.w;
                const overlapY = Math.abs(this.y - (b.y + b.h / 2)) / b.h;

                if (overlapX > overlapY) {
                    // 横方向の衝突
                    this.vx *= -1;
                    // ブロックの外側へ座標を強制移動（張り付き防止）
                    this.x = (this.x < b.x + b.w / 2) ? b.x - r : b.x + b.w + r;
                } else {
                    // 縦方向の衝突
                    this.vy *= -1;
                    // ブロックの外側へ座標を強制移動（張り付き防止）
                    this.y = (this.y < b.y + b.h / 2) ? b.y - r : b.y + b.h + r;
                }
                
                this.currentTarget = null; 
                break;
            }
        }
        return damageDone;
    }

    levelUp() {
        const nextLvl = this.level + 1;

        this.syncLevel(nextLvl);

        audio.play('evolution', 0.5);
    }

    draw(ctx) {
        const hue = (this.level * 45) % 360;
        const baseColor = `hsl(${hue}, 80%, 60%)`;
        const glowColor = `hsl(${hue}, 80%, 50%)`;
        const size = CONFIG.lifeBaseSize + this.level + Math.sin(this.pulse) * 1.5;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over'; 
        this.particles.forEach(p => {
            const alpha = (p.life / CONFIG.lifeTrailLife) * 0.15;
            ctx.fillStyle = glowColor; ctx.globalAlpha = alpha;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.2, 0, Math.PI * 2); ctx.fill();
        });
        ctx.translate(this.x, this.y);
        ctx.rotate(Math.atan2(this.vy, this.vx));
        for (let i = 0; i < 2; i++) {
            const s = size * (1.1 + i * 0.4);
            const a = 0.2 - i * 0.1;
            ctx.fillStyle = glowColor; ctx.globalAlpha = a;
            ctx.beginPath();
            ctx.arc(0, 0, s, Math.PI * 0.5, Math.PI * 1.5);
            ctx.bezierCurveTo(-s * 0.5, -s, -s * 2, -s * 0.1, -s * 3, 0);
            ctx.bezierCurveTo(-s * 2, s * 0.1, -s * 0.5, s, 0, s);
            ctx.fill();
        }
        ctx.globalAlpha = 0.8; ctx.fillStyle = `hsl(${hue}, 50%, 90%)`; 
        ctx.beginPath(); ctx.arc(size * 0.3, 0, size * 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        const gW = 24, gH = 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; ctx.fillRect(this.x - gW/2, this.y - size - 18, gW, gH);
        ctx.fillStyle = baseColor; ctx.globalAlpha = 0.6;
        ctx.fillRect(this.x - gW/2, this.y - size - 18, gW * (this.exp / this.nextLevelExp), gH);
        ctx.globalAlpha = 1.0;
    }
}

class Particle {
    constructor(x, y, vx, vy, color) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.color = color; this.life = CONFIG.particleLife; this.maxLife = CONFIG.particleLife;
    }
    update() {
        this.x += this.vx; this.y += this.vy; this.life--;
        this.vx *= 0.95; this.vy *= 0.95;
    }
    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = this.life / this.maxLife;
        ctx.beginPath(); ctx.arc(this.x, this.y, 2, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
    }
}

window.onload = () => new Game();
