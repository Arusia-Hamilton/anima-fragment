/**
 * ==========================================
 * CONFIGURATION（設定項目）
 * ==========================================
 */
const CONFIG = {
    // --- 背景・画面設定 ---
    bgColor: '#050508',      // 背景色（非常に濃い紺色）
    
    // --- ブロックの設定 ---
    blockWidth: 60,          // ブロック1つの横幅（ピクセル）
    blockHeight: 30,         // ブロック1つの縦幅（ピクセル）
    blockPadding: 8,         // ブロック同士の隙間の広さ
    blockRows: 20,           // 画面内に配置するブロックの最大行数

    // --- 生命体（LifeForm）の基本設定 ---
    lifeCount: 6,            // 最初に出現する生命体の数
    lifeBaseSize: 8,         // 生命体の基本サイズ（レベル1の時の大きさ）
    lifeBaseSpeed: 3,        // 生命体の移動速度の初期値
    lifeMaxSpeed: 10,        // レベルアップで上昇する速度の最大限界値
    lifeTurnRate: 0.12,      // 旋回性能（値が大きいほどターゲットに急旋回できる）
    
    // --- 生命体のエフェクト（残像）設定 ---
    lifeTrailDensity: 4,     // 残像の密度（1フレームに生成するパーティクル数）
    lifeTrailLife: 12,       // 残像が消えるまでの時間（値を大きくすると尻尾が長くなる）

    // --- 演出・ゲームバランス設定 ---
    particleCount: 20,       // ブロック破壊時に飛び散る破片の数
    particleLife: 40,        // 破片が消えるまでの時間
    baseExpToLevel: 8,       // レベル2に上がるために必要な経験値（以降は倍率で増加）
    hpMultiplier: 10,        // ブロックのHP計算用倍率（ステージ数 × この値 が最大HP）
};

/**
 * AUDIO MANAGER
 * 音の重なりや再生頻度を管理
 */
class AudioManager {
    constructor() {
        this.hitSoundPath = './sounds/c.mp3';
        this.destroySoundPath = './sounds/d.mp3';
        
        // 音声を使い回すための「プール」を作成
        this.hitPool = this.createPool(this.hitSoundPath, 15);     // ヒット音用：最大15同時再生
        this.destroyPool = this.createPool(this.destroySoundPath, 5); // 破壊音用：最大5同時再生
        
        this.hitIndex = 0;
        this.destroyIndex = 0;
        this.lastPlayTime = 0;
        this.minInterval = 50; 
    }

    // 指定された数だけAudioオブジェクトを事前に生成
    createPool(path, size) {
        const pool = [];
        for (let i = 0; i < size; i++) {
            const audio = new Audio(path);
            audio.load(); // データを事前に読み込む
            pool.push(audio);
        }
        return pool;
    }

    play(type, volume = 0.2) {
        const now = Date.now();
        
        // ヒット音の過剰な再生を防止
        if (type === 'hit') {
            if (now - this.lastPlayTime < this.minInterval) return;
            
            // プールから順番に1つ選んで再生
            const audio = this.hitPool[this.hitIndex];
            audio.volume = volume;
            audio.currentTime = 0; // 再生位置を先頭に戻す
            audio.play().catch(() => {});
            
            this.hitIndex = (this.hitIndex + 1) % this.hitPool.length;
            this.lastPlayTime = now;
        } 
        else if (type === 'destroy') {
            const audio = this.destroyPool[this.destroyIndex];
            audio.volume = volume;
            audio.currentTime = 0;
            audio.play().catch(() => {});
            
            this.destroyIndex = (this.destroyIndex + 1) % this.destroyPool.length;
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

        this.stats = {
            destroyedBlocks: 0,
            totalHits: 0,
            totalDamage: 0,
            startTime: Date.now(),
            damageHistory: [],
            initialTotalHp: 0  
        };
        
        this.width = this.canvas.width = window.innerWidth;
        this.height = this.canvas.height = window.innerHeight;

        window.addEventListener('resize', () => this.resize());

        const startScreen = document.getElementById('startScreen');
        startScreen.addEventListener('click', () => {
            if (!this.isStarted) {
                this.start();
                startScreen.style.display = 'none';
            }
        });

        this.initStage();
        this.spawnLifeForms();
        
        this.drawInitialFrame();
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
        this.ctx.fillStyle = CONFIG.bgColor;
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.drawAura();
        this.blocks.forEach(b => b.draw(this.ctx));
        // 生命体は描画のみ（動かさない）
        this.lifeForms.forEach(lf => {
            const hue = (lf.level * 45) % 360;
            this.ctx.fillStyle = `hsl(${hue}, 80%, 50%, 0.3)`;
            this.ctx.beginPath();
            this.ctx.arc(lf.x, lf.y, CONFIG.lifeBaseSize + lf.level, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    resize() {
        this.width = this.canvas.width = window.innerWidth;
        this.height = this.canvas.height = window.innerHeight;
        
        this.initStage();

        if (this.lifeForms) {
            this.lifeForms.forEach(lf => {
                lf.currentTarget = null;
            });
        }
    }

    initStage() {
        this.blocks = [];
        const cols = Math.floor(this.width / (CONFIG.blockWidth + CONFIG.blockPadding));
        const offsetX = (this.width - (cols * (CONFIG.blockWidth + CONFIG.blockPadding))) / 2;
        let totalHp = 0;
        const seedA = Math.random() * 2 + 0.2;
        const seedB = Math.random() * 2 + 0.2;
        const threshold = Math.random() * 0.4 - 0.2;
        const safeZoneHeight = 350; 
        const centerY = this.height / 2;

        for (let r = 0; r < CONFIG.blockRows; r++) {
            const y = 80 + r * (CONFIG.blockHeight + CONFIG.blockPadding);
            if (y > this.height - 50) continue;
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
            this.lifeForms.push(new LifeForm(this.width / 2, this.height / 2));
        }
    }

    updateDPS(damage) {
        const now = Date.now();
        this.stats.totalDamage += damage;
        this.stats.totalHits += 1;
        this.stats.damageHistory.push({ time: now, val: damage });
    }

    getAverageDPS() {
        const now = Date.now();
        this.stats.damageHistory = this.stats.damageHistory.filter(d => now - d.time < 1000);
        return this.stats.damageHistory.reduce((sum, d) => sum + d.val, 0);
    }

    loop() {
        if (!this.isStarted) return;

        this.ctx.fillStyle = CONFIG.bgColor;
        this.ctx.fillRect(0, 0, this.width, this.height);

        this.drawAura();
        this.drawUI();

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

        this.lifeForms.forEach(lf => {
            const damageDealt = lf.update(this.blocks, this.width, this.height);
            if (damageDealt > 0) this.updateDPS(damageDealt);
            lf.draw(this.ctx);
        });

        for (let i = this.effects.length - 1; i >= 0; i--) {
            this.effects[i].update();
            this.effects[i].draw(this.ctx);
            if (this.effects[i].life <= 0) this.effects.splice(i, 1);
        }

        if (this.blocks.length === 0) {
            this.stage++;
            this.initStage();
            this.lifeForms.forEach(lf => {
                lf.x = this.width / 2;
                lf.y = this.height / 2;
                lf.currentTarget = null;
            });
        }

        requestAnimationFrame(() => this.loop());
    }

    drawAura() {
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        this.auraRotation += 0.005;
        this.ctx.save();
        this.ctx.translate(centerX, centerY);
        this.ctx.rotate(this.auraRotation);
        this.ctx.beginPath();
        for(let i=0; i<6; i++) {
            const angle = i * Math.PI / 3;
            const r = 240 + Math.sin(Date.now() * 0.002) * 10;
            this.ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
        }
        this.ctx.closePath();
        this.ctx.strokeStyle = 'rgba(0, 200, 255, 0.12)';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
        const grad = this.ctx.createRadialGradient(0, 0, 50, 0, 0, 280);
        grad.addColorStop(0, 'rgba(0, 80, 255, 0.08)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.ctx.fillStyle = grad;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 280, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
    }

    drawUI() {
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        const currentTotalHp = this.blocks.reduce((sum, b) => sum + b.hp, 0);
        const progress = 1 - (currentTotalHp / this.stats.initialTotalHp || 0);
        const dps = Math.floor(this.getAverageDPS()); // 小数点を切り捨て
        const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
        const maxUnitLevel = Math.max(...this.lifeForms.map(lf => lf.level));
        const totalAttack = this.lifeForms.reduce((s, l) => s + l.attack, 0);

        // 1. 進捗バー
        const barW = 400, barH = 2;
        const barY = 30;
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(centerX - barW/2, barY, barW, barH);
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = 'rgba(0, 255, 0, 0.5)';
        this.ctx.fillStyle = '#0f0';
        this.ctx.fillRect(centerX - barW/2, barY, barW * progress, barH);
        this.ctx.shadowBlur = 0;

        // 2. プロジェクト名
        const titleY = barY + 60;
        this.ctx.textAlign = 'center';
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = 'rgba(0, 200, 255, 0.3)';
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        this.ctx.font = 'bold 32px "Courier New", monospace';
        this.ctx.letterSpacing = "8px";
        this.ctx.fillText("ANIMA FRAGMENT", centerX, titleY);
        this.ctx.letterSpacing = "0px";
        this.ctx.shadowBlur = 0;

        // 3. PHASE表示
        const phaseY = centerY - 80; 
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = 'rgba(0, 200, 255, 0.1)';
        this.ctx.font = 'bold 85px "Courier New", monospace';
        this.ctx.fillText(`PHASE_${this.stage.toLocaleString()}`, centerX, phaseY);

        // 4. スタッツ情報（名称の変更とカンマ区切り適用）
        this.ctx.font = '16px "Courier New", monospace'; // 項目名が長くなったので少しフォントを調整
        const statsLineY = phaseY + 40;
        const spacing = 28;
        const columnGap = 12;

        const data = [
            [this.lifeForms.length.toLocaleString(), "UNITS_ACTIVE"],
            [this.stats.destroyedBlocks.toLocaleString(), "BLOCKS_DESTROYED"], // CLEARED -> DESTROYED
            [this.stats.totalHits.toLocaleString(), "CONTACT_HITS"],          // SYSTEM_HITS -> CONTACT_HITS
            [this.stats.totalDamage.toLocaleString(), "TOTAL_DAMAGE"],
            [dps.toLocaleString() + "/s", "DAMAGE_PER_SEC"],                  // DMG_VELOCITY -> DAMAGE_PER_SEC
            [totalAttack.toLocaleString(), "TOTAL_ATTACK_PWR"],               // ATK_POTENTIAL -> TOTAL_ATTACK_PWR
            ["LV." + maxUnitLevel.toLocaleString(), "MAX_UNIT_LEVEL"],        // MAX_LEVEL -> MAX_UNIT_LEVEL
            [this.formatTime(uptime), "SYSTEM_UPTIME"]
        ];

        data.forEach((item, i) => {
            const y = statsLineY + (i * spacing);
            this.ctx.shadowBlur = 4;
            this.ctx.shadowColor = 'rgba(255, 255, 255, 0.2)';
            this.ctx.textAlign = 'right';
            this.ctx.fillStyle = '#fff';
            this.ctx.fillText(item[0], centerX - columnGap, y);
            this.ctx.textAlign = 'center';
            this.ctx.fillStyle = 'rgba(0, 200, 255, 0.5)';
            this.ctx.fillText(":", centerX, y);
            this.ctx.textAlign = 'left';
            this.ctx.fillStyle = 'rgba(0, 200, 255, 0.7)';
            this.ctx.fillText(item[1], centerX + columnGap, y);
            this.ctx.shadowBlur = 0;
        });
    }

    formatTime(s) {
        const min = Math.floor(s / 60);
        const sec = s % 60;
        return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }

    createExplosion(x, y, color) {
        for (let i = 0; i < CONFIG.particleCount; i++) {
            this.effects.push(new ExplosionParticle(x, y, color));
        }
    }
}

class Block {
    constructor(x, y, hp) {
        this.x = x; this.y = y;
        this.w = CONFIG.blockWidth; this.h = CONFIG.blockHeight;
        this.hp = hp; this.isDead = false;
        this.color = '';
        this.hitEffect = 0;
    }

    takeDamage(damage) {
        this.hp -= damage;
        this.hitEffect = 1.0;
        
        if (this.hp <= 0) {
            this.isDead = true;
            // 引数をパスではなくキーワードに変更
            audio.play('destroy', 0.4); 
        } else {
            audio.play('hit', 0.15); 
        }
    }

    draw(ctx) {
        const hue = (200 + this.hp) % 360;
        this.color = `hsl(${hue}, 80%, 40%)`;
        
        if (this.hitEffect > 0) {
            ctx.save();
            ctx.shadowBlur = 15 * this.hitEffect;
            ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
            ctx.strokeStyle = `rgba(255, 255, 255, ${this.hitEffect})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(this.x - 2, this.y - 2, this.w + 4, this.h + 4);
            ctx.restore();
            this.hitEffect *= 0.9;
            if (this.hitEffect < 0.01) this.hitEffect = 0;
        }

        ctx.fillStyle = this.color;
        ctx.strokeStyle = `hsl(${hue}, 100%, 70%)`;
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.strokeRect(this.x, this.y, this.w, this.h);
        
        ctx.fillStyle = '#fff';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
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
        this.speed = CONFIG.lifeBaseSpeed;
        this.vx = Math.cos(angle) * this.speed;
        this.vy = Math.sin(angle) * this.speed;
        this.level = 1; this.attack = 1; this.exp = 0;
        this.nextLevelExp = CONFIG.baseExpToLevel;
        this.particles = []; this.pulse = 0;
        this.currentTarget = null;
    }

    getToroidalVector(targetX, targetY, screenW, screenH) {
        let dx = targetX - this.x;
        let dy = targetY - this.y;
        if (Math.abs(dx) > screenW / 2) dx = dx > 0 ? dx - screenW : dx + screenW;
        if (Math.abs(dy) > screenH / 2) dy = dy > 0 ? dy - screenH : dy + screenH;
        return { dx, dy, distSq: dx * dx + dy * dy };
    }

    update(blocks, screenW, screenH) {
        this.pulse += 0.08;
        let damageDone = 0;
        for (let i = 0; i < CONFIG.lifeTrailDensity; i++) {
            this.particles.push({
                x: this.x, 
                y: this.y, 
                life: CONFIG.lifeTrailLife,
                size: (CONFIG.lifeBaseSize + this.level) * (1 - i/CONFIG.lifeTrailDensity)
            });
        }
        for (let i = this.particles.length-1; i>=0; i--) {
            this.particles[i].life--;
            if (this.particles[i].life <= 0) this.particles.splice(i, 1);
        }
        if (!this.currentTarget || this.currentTarget.isDead) {
            if (blocks.length > 0) {
                let minDistSq = Infinity;
                let found = null;
                blocks.forEach(b => {
                    const vector = this.getToroidalVector(b.x + b.w/2, b.y + b.h/2, screenW, screenH);
                    if (vector.distSq < minDistSq) { minDistSq = vector.distSq; found = b; }
                });
                this.currentTarget = found;
            }
        }
        if (this.currentTarget) {
            const vector = this.getToroidalVector(this.currentTarget.x + this.currentTarget.w/2, this.currentTarget.y + this.currentTarget.h/2, screenW, screenH);
            const targetAngle = Math.atan2(vector.dy, vector.dx);
            const currentAngle = Math.atan2(this.vy, this.vx);
            let delta = targetAngle - currentAngle;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            const turn = Math.max(-CONFIG.lifeTurnRate, Math.min(CONFIG.lifeTurnRate, delta));
            this.vx = Math.cos(currentAngle + turn) * this.speed;
            this.vy = Math.sin(currentAngle + turn) * this.speed;
        }
        this.x += this.vx; this.y += this.vy;
        if (this.x < 0) this.x += screenW; else if (this.x >= screenW) this.x -= screenW;
        if (this.y < 0) this.y += screenH; else if (this.y >= screenH) this.y -= screenH;
        const r = CONFIG.lifeBaseSize + this.level;
        for (const b of blocks) {
            if (this.x > b.x-r && this.x < b.x+b.w+r && this.y > b.y-r && this.y < b.y+b.h+r) {
                b.takeDamage(this.attack);
                damageDone = this.attack;
                this.exp++;
                if (this.exp >= this.nextLevelExp) this.levelUp();
                if (Math.abs(this.x - (b.x+b.w/2))/b.w > Math.abs(this.y - (b.y+b.h/2))/b.h) this.vx *= -1;
                else this.vy *= -1;
                this.currentTarget = null; 
                break;
            }
        }
        return damageDone;
    }

    levelUp() {
        this.level++; this.attack = this.level; this.exp = 0;
        this.nextLevelExp = Math.floor(this.nextLevelExp * 1.5);
        if (this.speed < CONFIG.lifeMaxSpeed) this.speed += 0.3;
    }

draw(ctx) {
        const hue = (this.level * 45) % 360;
        const baseColor = `hsl(${hue}, 80%, 60%)`;
        const glowColor = `hsl(${hue}, 80%, 50%)`;
        const size = CONFIG.lifeBaseSize + this.level + Math.sin(this.pulse) * 1.5;

        ctx.save();
        
        ctx.globalCompositeOperation = 'source-over'; 

        // 1. 残像
        this.particles.forEach(p => {
            const alpha = (p.life / CONFIG.lifeTrailLife) * 0.15;
            ctx.fillStyle = glowColor;
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 1.2, 0, Math.PI * 2);
            ctx.fill();
        });

        // 2. 本体
        ctx.translate(this.x, this.y);
        ctx.rotate(Math.atan2(this.vy, this.vx));

        // 輪郭のぼかし
        for (let i = 0; i < 2; i++) {
            const s = size * (1.1 + i * 0.4);
            const a = 0.2 - i * 0.1;
            ctx.fillStyle = glowColor;
            ctx.globalAlpha = a;
            
            ctx.beginPath();
            ctx.arc(0, 0, s, Math.PI * 0.5, Math.PI * 1.5);
            ctx.bezierCurveTo(-s * 0.5, -s, -s * 2, -s * 0.1, -s * 3, 0);
            ctx.bezierCurveTo(-s * 2, s * 0.1, -s * 0.5, s, 0, s);
            ctx.fill();
        }

        // 最深部
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = `hsl(${hue}, 50%, 90%)`; 
        ctx.beginPath();
        ctx.arc(size * 0.3, 0, size * 0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // 経験値バー
        const gW = 24, gH = 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(this.x - gW/2, this.y - size - 18, gW, gH);
        ctx.fillStyle = baseColor;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(this.x - gW/2, this.y - size - 18, gW * (this.exp / this.nextLevelExp), gH);
        ctx.globalAlpha = 1.0;
    }
}

window.onload = () => new Game();
