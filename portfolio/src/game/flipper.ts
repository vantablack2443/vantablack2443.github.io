import * as pl from 'planck';
import { FlipperDef, toM } from '../layout';

export interface FlipperTuning {
  density: number;
  friction: number;
  restitution: number;
  maxTorque: number;
  motorSpeed: number;
}

/**
 * A flipper is a dynamic body pinned to the table by a revolute joint. The
 * joint has angular limits (rest / raised) and an always-on motor: while the
 * button is held the motor drives the flipper up, otherwise it drives it back
 * down, so it drops fast and the ball is always pushed by a real moving body.
 */
export class Flipper {
  readonly def: FlipperDef;
  readonly body: pl.Body;
  readonly joint: pl.RevoluteJoint;
  private readonly upSign: number;
  private readonly speed: number;
  held = false;

  constructor(world: pl.World, ground: pl.Body, def: FlipperDef, t: FlipperTuning) {
    this.def = def;
    this.speed = t.motorSpeed;
    const dir = def.side === 'left' ? 1 : -1; // local x direction of the blade
    const [px, py] = def.pivot;

    this.body = world.createBody({
      type: 'dynamic',
      position: pl.Vec2(toM(px), toM(py)),
      angle: def.restAngle,
      bullet: true,
      gravityScale: 0,
      angularDamping: 0,
    });
    const L = toM(def.length);
    const rb = toM(def.baseR);
    const rt = toM(def.tipR);
    const opt = { density: t.density, friction: t.friction, restitution: t.restitution };
    this.body.createFixture(
      new pl.Polygon([
        pl.Vec2(0, -rb),
        pl.Vec2(dir * L, -rt),
        pl.Vec2(dir * L, rt),
        pl.Vec2(0, rb),
      ]),
      { ...opt, userData: { kind: 'flipper', side: def.side } },
    );
    this.body.createFixture(new pl.Circle(pl.Vec2(0, 0), rb), {
      ...opt,
      userData: { kind: 'flipper', side: def.side },
    });
    this.body.createFixture(new pl.Circle(pl.Vec2(dir * L, 0), rt), {
      ...opt,
      userData: { kind: 'flipper', side: def.side },
    });

    const sweep = def.upAngle - def.restAngle; // relative joint angle when raised
    this.upSign = Math.sign(sweep);
    this.joint = world.createJoint(
      pl.RevoluteJoint(
        {
          lowerAngle: Math.min(0, sweep),
          upperAngle: Math.max(0, sweep),
          enableLimit: true,
          enableMotor: true,
          maxMotorTorque: t.maxTorque,
          motorSpeed: -this.upSign * this.speed,
        },
        ground,
        this.body,
        pl.Vec2(toM(px), toM(py)),
      ),
    ) as pl.RevoluteJoint;
  }

  setHeld(on: boolean): void {
    this.held = on;
    this.joint.setMotorSpeed((on ? this.upSign : -this.upSign) * this.speed);
  }

  /** 0 = at rest, 1 = fully raised. */
  get raise(): number {
    const sweep = this.def.upAngle - this.def.restAngle;
    return Math.min(1, Math.max(0, this.joint.getJointAngle() / sweep));
  }

  /** Current direction angle pivot -> tip in the DOM's y-down screen space. */
  get angle(): number {
    return this.body.getAngle();
  }
}
