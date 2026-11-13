// =====================================================================
//  player.js — Le joueur local : déplacements, course, glissade, saut,
//  accroupi, caméra.
// =====================================================================
import { PLAYER } from '/shared/constants.js';
import { MAP_BOXES } from '/shared/map.js';
import { moveAndCollide, canStand } from '/shared/physics.js';
import { settings } from './settings.js';
import { sfx } from './audio.js';

export class LocalPlayer {
  constructor(camera) {
    this.camera = camera;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0;
    this.crouch = false;
    this.eyeHeight = PLAYER.EYE;   // animé en douceur quand on s'accroupit
    this.grounded = true;
    this.hp = PLAYER.MAX_HP;
    this.alive = true;
    this.bob = 0;                  // balancement de la marche
    this.sprinting = false;
    this.slideTime = 0;            // > 0 pendant une glissade
    this.slideCooldown = 0;
    this.fovBoost = 0;             // le champ de vision s'élargit en courant
    this.roll = 0;                 // inclinaison de la caméra pendant la glissade
    this.zoom = 1;                 // zoom de visée (donné par weapons.js)
    this.ads = 0;                  // 0 = sans viser, 1 = en visée
  }

  spawn(s) {
    this.pos = { x: s.x, y: s.y || 0, z: s.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = s.yaw; this.pitch = 0;
    this.crouch = false; this.hp = PLAYER.MAX_HP; this.alive = true;
    this.sprinting = false; this.slideTime = 0; this.zoom = 1; this.ads = 0;
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get sliding() { return this.slideTime > 0; }

  /** Rotation de la caméra à la souris */
  look(input) {
    const [dx, dy] = input.consumeMouse();
    this.lastLook = [dx, dy];
    const k = 0.0022 * settings.sensitivity / this.zoom; // moins sensible quand on zoome
    this.yaw -= dx * k;
    this.pitch -= dy * k * (settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
  }

  /** canMove = false pendant le temps de préparation d'une manche */
  update(dt, input, canMove) {
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);

    // --- Direction voulue (relative au regard) ---
    let fx = 0, fz = 0;
    if (canMove) {
      if (input.is('forward')) fz -= 1;
      if (input.is('back')) fz += 1;
      if (input.is('left')) fx -= 1;
      if (input.is('right')) fx += 1;
    }
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = fx * cos + fz * sin;
    const wishZ = -fx * sin + fz * cos;

    // --- Course : touche Courir + avancer, pas accroupi, pas en train de tirer ---
    this.sprinting = canMove && input.is('sprint') && fz < 0 && !this.crouch && !input.mouseDown && !input.mouseRight;

    // --- Glissade : appuyer sur Accroupi pendant qu'on court ---
    if (canMove && input.was('crouch') && this.sprinting && this.grounded && this.slideCooldown <= 0) {
      const sp = this.speed || 1;
      const dirX = this.vel.x / sp, dirZ = this.vel.z / sp;
      this.vel.x = dirX * PLAYER.SLIDE_SPEED;
      this.vel.z = dirZ * PLAYER.SLIDE_SPEED;
      this.slideTime = PLAYER.SLIDE_TIME;
      this.crouch = true;
      this.sprinting = false;
      sfx.slide();
    }

    if (this.sliding) {
      // Pendant la glissade : on garde l'élan, qui diminue petit à petit
      this.slideTime -= dt;
      this.crouch = true;
      const friction = Math.max(0, 1 - dt * 1.8);
      this.vel.x *= friction; this.vel.z *= friction;
      // On peut légèrement orienter la glissade
      this.vel.x += wishX * 4 * dt; this.vel.z += wishZ * 4 * dt;
      // Sauter pendant une glissade = saut avec l'élan (slide-jump)
      if (canMove && input.is('jump') && this.grounded && canStand(this.pos, MAP_BOXES)) {
        this.vel.y = PLAYER.JUMP_SPEED;
        this.grounded = false;
        this.endSlide();
        this.crouch = false;
      }
      if (this.slideTime <= 0 || this.speed < PLAYER.CROUCH_SPEED) this.endSlide();
    } else {
      // --- Accroupi (on ne se relève que s'il y a de la place) ---
      const wantCrouch = canMove && input.is('crouch');
      if (wantCrouch) this.crouch = true;
      else if (this.crouch && canStand(this.pos, MAP_BOXES)) this.crouch = false;

      const maxSpeed = (this.crouch ? PLAYER.CROUCH_SPEED : this.sprinting ? PLAYER.SPRINT_SPEED : PLAYER.SPEED) * (1 - 0.45 * this.ads); // plus lent en visée
      // Accélération rapide au sol, contrôle réduit en l'air
      const accel = this.grounded ? 12 : 2.5;
      const t = Math.min(1, accel * dt);
      this.vel.x += (wishX * maxSpeed - this.vel.x) * t;
      this.vel.z += (wishZ * maxSpeed - this.vel.z) * t;

      // --- Saut ---
      // Petite tolérance : on peut encore sauter 0,1 s après avoir quitté un rebord (coyote time),
      // et un appui juste avant d'atterrir est gardé 0,12 s (saut "tampon").
      if (input.was('jump')) this.jumpBuffer = 0.12;
      const canJump = this.grounded || (this.airTime < 0.1 && this.vel.y <= 0);
      if (canMove && canJump && (input.is('jump') || this.jumpBuffer > 0) && !this.crouch) {
        this.vel.y = PLAYER.JUMP_SPEED;
        this.grounded = false;
        this.jumpBuffer = 0; this.airTime = 1;
      }
    }

    // --- Gravité + collisions ---
    this.vel.y -= PLAYER.GRAVITY * dt;
    const height = this.crouch ? PLAYER.CROUCH_HEIGHT : PLAYER.HEIGHT;
    const fallSpeed = -this.vel.y;
    const wasGrounded = this.grounded;
    this.grounded = moveAndCollide(this.pos, this.vel, dt, height, MAP_BOXES, this.grounded);
    this.airTime = this.grounded ? 0 : (this.airTime || 0) + dt;
    this.jumpBuffer = Math.max(0, (this.jumpBuffer || 0) - dt);
    // Atterrissage : on note la force de l'impact (pour l'animation de l'arme et le son)
    this.landed = !wasGrounded && this.grounded && fallSpeed > 3 ? Math.min(1, fallSpeed / 12) : 0;
    // Pas : un bruit tous les ~2,3 m (pas de bruit accroupi ou en glissade)
    if (this.grounded && !this.crouch && this.speed > 2.5) {
      this.stepDist = (this.stepDist || 0) + this.speed * dt;
      if (this.stepDist > (this.sprinting ? 2.6 : 2.2)) { this.stepDist = 0; this.stepped = this.sprinting ? 2 : 1; }
    }

    // Sécurité : si on tombe hors de la map (bug), on remonte
    if (this.pos.y < -5) this.pos.y = 2;

    // --- Caméra ---
    const targetEye = this.sliding ? PLAYER.CROUCH_EYE - 0.2 : this.crouch ? PLAYER.CROUCH_EYE : PLAYER.EYE;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, 15 * dt);
    if (this.grounded && this.speed > 0.5 && !this.sliding) this.bob += dt * this.speed * 1.6;
    const wantBoost = this.sprinting ? 8 : this.sliding ? 12 : 0;
    this.fovBoost += (wantBoost - this.fovBoost) * Math.min(1, 8 * dt);
    const wantRoll = this.sliding ? 0.06 : 0;
    this.roll += (wantRoll - this.roll) * Math.min(1, 10 * dt);
    this.applyCamera();
  }

  endSlide() {
    this.slideTime = 0;
    this.slideCooldown = PLAYER.SLIDE_COOLDOWN;
  }

  applyCamera() {
    const bobY = Math.sin(this.bob * 2) * (this.sprinting ? 0.05 : 0.035);
    this.camera.position.set(this.pos.x, this.pos.y + this.eyeHeight + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll);
    // Zoom : on réduit le champ de vision (formule exacte avec la tangente)
    const baseFov = settings.fov + this.fovBoost;
    const fov = 2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / this.zoom) * 180 / Math.PI;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Position des yeux (point de départ des tirs) */
  eye() {
    return { x: this.pos.x, y: this.pos.y + (this.crouch ? PLAYER.CROUCH_EYE : PLAYER.EYE), z: this.pos.z };
  }
}
