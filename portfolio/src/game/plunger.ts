import * as pl from 'planck';
import { PLUNGER, toM } from '../layout';

export interface PlungerTuning {
  chargeTime: number; // seconds to reach full charge
  minSpeed: number; // m/s at charge 0
  maxSpeed: number; // m/s at charge 1
}

/**
 * Kinematic plunger tip the ball rests on. While charging it slides down the
 * lane; on release the table teleports it back and gives the ball an upward
 * launch velocity proportional to the charge.
 */
export class Plunger {
  readonly body: pl.Body;
  charge = 0;
  private wasHeld = false;
  private readonly t: PlungerTuning;
  private readonly restY: number; // body centre at rest (metres)

  constructor(world: pl.World, t: PlungerTuning) {
    this.t = t;
    this.restY = toM(PLUNGER.restTop + PLUNGER.halfH);
    this.body = world.createBody({
      type: 'kinematic',
      position: pl.Vec2(toM(PLUNGER.x), this.restY),
    });
    this.body.createFixture(new pl.Box(toM(PLUNGER.halfW), toM(PLUNGER.halfH)), {
      friction: 0.1,
      restitution: 0,
      userData: { kind: 'plunger' },
    });
  }

  /** Visual pull-down in logical px. */
  get pull(): number {
    return this.charge * PLUNGER.travel;
  }

  launchSpeed(power: number): number {
    return this.t.minSpeed + (this.t.maxSpeed - this.t.minSpeed) * Math.min(1, Math.max(0, power));
  }

  /**
   * Advance the charge. Returns the charge (0..1) if the player released the
   * plunger on this step (a launch should happen), otherwise null.
   */
  update(dt: number, held: boolean): number | null {
    let released: number | null = null;
    if (held) {
      const next = Math.min(1, this.charge + dt / this.t.chargeTime);
      const dy = (next - this.charge) * toM(PLUNGER.travel);
      this.body.setLinearVelocity(pl.Vec2(0, dy / dt));
      this.charge = next;
    } else {
      this.body.setLinearVelocity(pl.Vec2(0, 0));
      if (this.wasHeld) released = this.charge;
      this.reset();
    }
    this.wasHeld = held;
    return released;
  }

  reset(): void {
    this.charge = 0;
    this.body.setPosition(pl.Vec2(toM(PLUNGER.x), this.restY));
    this.body.setLinearVelocity(pl.Vec2(0, 0));
  }
}
