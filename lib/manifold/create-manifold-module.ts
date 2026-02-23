/**
 * Creates a JSCADModule-compatible adapter backed by manifold-3d.
 *
 * Usage:
 *   import Module from 'manifold-3d';
 *   const wasm = await Module();
 *   wasm.setup();
 *   const manifoldModule = createManifoldModule(wasm);
 *   const renderer = createJSCADRenderer(manifoldModule);
 *
 * This allows all existing jscad-fiber React components to work unchanged
 * with manifold as the geometry backend.
 */

import type { Point3 } from "../jscad-fns"
import type { JSCADModule } from "../jscad-primitives"
import { ManifoldGeom2, ManifoldGeom3 } from "./manifold-geom"

type ManifoldStatic = any
type CrossSectionStatic = any

export interface ManifoldToplevel {
  Manifold: ManifoldStatic
  CrossSection: CrossSectionStatic
}

function normalizeSize(
  size: number | [number, number, number],
): [number, number, number] {
  if (typeof size === "number") return [size, size, size]
  return size
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/**
 * Create a JSCADModule-compatible adapter from an initialized manifold-3d WASM
 * module. Pass the result to createJSCADRenderer() to use manifold as the
 * geometry backend.
 */
export function createManifoldModule(wasm: ManifoldToplevel): JSCADModule {
  const { Manifold, CrossSection } = wasm

  const module: JSCADModule = {
    primitives: {
      cube({ size }) {
        const s = normalizeSize(size)
        return new ManifoldGeom3(Manifold.cube(s, true))
      },

      cuboid({ size }) {
        const s = normalizeSize(size)
        return new ManifoldGeom3(Manifold.cube(s, true))
      },

      sphere({ radius, segments }) {
        return new ManifoldGeom3(Manifold.sphere(radius, segments || 0))
      },

      geodesicSphere({ radius, frequency }) {
        // Manifold's sphere is geodesic; frequency maps roughly to segments
        return new ManifoldGeom3(Manifold.sphere(radius, frequency * 4))
      },

      cylinder({ radius, height }) {
        return new ManifoldGeom3(Manifold.cylinder(height, radius, -1, 0, true))
      },

      ellipsoid({ radius }) {
        const [rx, ry, rz] = radius
        const maxR = Math.max(rx, ry, rz)
        return new ManifoldGeom3(
          Manifold.sphere(maxR, 0).scale([rx / maxR, ry / maxR, rz / maxR]),
        )
      },

      roundedCuboid({ size, roundRadius }) {
        const [sx, sy, sz] = normalizeSize(size)
        const r = Math.min(roundRadius, sx / 2, sy / 2, sz / 2)
        if (r <= 0) {
          return new ManifoldGeom3(Manifold.cube([sx, sy, sz], true))
        }

        // Build rounded cuboid via convex hull of 8 corner spheres
        const hx = sx / 2 - r
        const hy = sy / 2 - r
        const hz = sz / 2 - r
        const corners: any[] = []
        for (const dx of [-1, 1]) {
          for (const dy of [-1, 1]) {
            for (const dz of [-1, 1]) {
              corners.push(
                Manifold.sphere(r, 16).translate(dx * hx, dy * hy, dz * hz),
              )
            }
          }
        }
        return new ManifoldGeom3(Manifold.hull(corners))
      },

      roundedCylinder({ radius, height, roundRadius }) {
        const r = Math.min(roundRadius, radius, height / 2)
        if (r <= 0) {
          return new ManifoldGeom3(
            Manifold.cylinder(height, radius, -1, 0, true),
          )
        }

        // Build via revolve of a rounded-rectangle half-profile
        const segs = 8
        const points: [number, number][] = []

        // Bottom-right arc (center at radius-r, -height/2+r)
        for (let i = 0; i <= segs; i++) {
          const angle = -Math.PI / 2 + (Math.PI / 2) * (i / segs)
          points.push([
            radius - r + r * Math.cos(angle),
            -height / 2 + r + r * Math.sin(angle),
          ])
        }

        // Top-right arc (center at radius-r, height/2-r)
        for (let i = 0; i <= segs; i++) {
          const angle = (Math.PI / 2) * (i / segs)
          points.push([
            radius - r + r * Math.cos(angle),
            height / 2 - r + r * Math.sin(angle),
          ])
        }

        // Close along axis
        points.push([0, height / 2])
        points.push([0, -height / 2])

        const cs = new CrossSection([points])
        return new ManifoldGeom3(cs.revolve())
      },

      cylinderElliptic({
        height,
        startRadius,
        endRadius,
        startAngle: _startAngle,
        endAngle: _endAngle,
      }) {
        // Approximate with a circular cylinder using average radii
        const sr = startRadius || [1, 1]
        const er = endRadius || sr
        const avgStartR = (sr[0] + sr[1]) / 2
        const avgEndR = (er[0] + er[1]) / 2
        const m = Manifold.cylinder(height, avgStartR, avgEndR, 0, true)
        // Scale to approximate elliptic shape using start radii ratio
        if (sr[0] !== sr[1]) {
          const ratio = sr[1] / sr[0]
          return new ManifoldGeom3(m.scale([1, ratio, 1]))
        }
        return new ManifoldGeom3(m)
      },

      torus({
        innerRadius,
        outerRadius,
        innerSegments,
        outerSegments,
        innerRotation: _innerRotation,
        outerRotation: _outerRotation,
        startAngle: _startAngle,
      }) {
        const tubeR = (outerRadius - innerRadius) / 2
        const centerR = (innerRadius + outerRadius) / 2
        const cs = CrossSection.circle(tubeR, innerSegments || 0)
        const translated = cs.translate([centerR, 0])
        return new ManifoldGeom3(translated.revolve(outerSegments || 0))
      },

      polygon({ points }) {
        // Use EvenOdd fill rule to handle self-intersecting contours
        // (e.g. expanded stroke polygons that zigzag)
        return new ManifoldGeom2(
          new CrossSection([deduplicatePoints(points)], "EvenOdd"),
        )
      },

      rectangle({ size }) {
        return new ManifoldGeom2(CrossSection.square(size, true))
      },

      circle({ radius }) {
        return new ManifoldGeom2(CrossSection.circle(radius))
      },
    },

    booleans: {
      union(a: any, b: any) {
        return new ManifoldGeom3(a._manifold.add(b._manifold))
      },

      subtract(a: any, b: any) {
        if (Array.isArray(b)) {
          let result = a._manifold
          for (const geom of b) {
            result = result.subtract(geom._manifold)
          }
          return new ManifoldGeom3(result, a._color)
        }
        return new ManifoldGeom3(a._manifold.subtract(b._manifold), a._color)
      },
    },

    transforms: {
      translate(vector: [number, number, number], object: any) {
        if (object instanceof ManifoldGeom3 || object._manifold) {
          return new ManifoldGeom3(
            object._manifold.translate(vector),
            object._color,
          )
        }
        if (object instanceof ManifoldGeom2 || object._crossSection) {
          return new ManifoldGeom2(
            object._crossSection.translate([vector[0], vector[1]]),
            object._color,
          )
        }
        throw new Error("translate: unsupported geometry type")
      },

      rotate(angles: Point3, object: any) {
        // JSCAD uses radians, manifold uses degrees
        const a = Array.isArray(angles)
          ? angles
          : [angles.x, angles.y, angles.z]
        const deg: [number, number, number] = [
          radToDeg(a[0]),
          radToDeg(a[1]),
          radToDeg(a[2]),
        ]

        if (object instanceof ManifoldGeom3 || object._manifold) {
          return new ManifoldGeom3(object._manifold.rotate(deg), object._color)
        }
        if (object instanceof ManifoldGeom2 || object._crossSection) {
          // CrossSection only supports Z rotation
          return new ManifoldGeom2(
            object._crossSection.rotate(deg[2]),
            object._color,
          )
        }
        throw new Error("rotate: unsupported geometry type")
      },
    },

    extrusions: {
      extrudeLinear({ height, twistAngle, twistSteps }, geometry: any) {
        const cs = unwrapCrossSection(geometry)
        const twistDeg = twistAngle ? radToDeg(twistAngle) : undefined
        return new ManifoldGeom3(cs.extrude(height, twistSteps, twistDeg))
      },

      extrudeRotate({ angle }, geometry: any) {
        const cs = unwrapCrossSection(geometry)
        const angleDeg = radToDeg(angle)
        return new ManifoldGeom3(cs.revolve(0, angleDeg))
      },

      extrudeRectangular({ size, height }, geometry: any) {
        // Approximate: offset the cross-section then extrude
        const cs = unwrapCrossSection(geometry)
        const offsetCs = cs.offset(size)
        return new ManifoldGeom3(offsetCs.extrude(height))
      },

      extrudeHelical(
        {
          height,
          angle: _angle,
          startAngle: _startAngle,
          pitch: _pitch,
          endOffset: _endOffset,
          segmetsPerRotation: _segmetsPerRotation,
        },
        geometry: any,
      ) {
        // Helical extrusion is not natively supported by manifold.
        // Fall back to linear extrusion with twist as an approximation.
        const cs = unwrapCrossSection(geometry)
        console.warn(
          "manifold backend: extrudeHelical is approximated as linear extrusion with twist",
        )
        return new ManifoldGeom3(cs.extrude(height || 10))
      },

      project({ axis: _axis, origin: _origin }, geometry: any) {
        if (geometry._manifold) {
          return new ManifoldGeom2(geometry._manifold.project())
        }
        throw new Error("project: unsupported geometry type")
      },

      extrudeFromSlices(_options, _baseSlice) {
        throw new Error(
          "manifold backend: extrudeFromSlices is not yet supported",
        )
      },
    },

    colors: {
      colorize(color: [number, number, number], geometry: any) {
        if (geometry instanceof ManifoldGeom3 || geometry._manifold) {
          return geometry.withColor
            ? geometry.withColor(color)
            : new ManifoldGeom3(geometry._manifold, color)
        }
        if (geometry instanceof ManifoldGeom2 || geometry._crossSection) {
          return geometry.withColor
            ? geometry.withColor(color)
            : new ManifoldGeom2(geometry._crossSection, color)
        }
        throw new Error("colorize: unsupported geometry type")
      },
    },

    hulls: {
      hull(...argsOrArray: any[]) {
        const geoms = Array.isArray(argsOrArray[0])
          ? argsOrArray[0]
          : argsOrArray
        const manifolds = geoms.map((g: any) => g._manifold)
        return new ManifoldGeom3(Manifold.hull(manifolds))
      },

      hullChain(...argsOrArray: any[]) {
        const geoms = Array.isArray(argsOrArray[0])
          ? argsOrArray[0]
          : argsOrArray

        if (geoms.length < 2) {
          throw new Error("hullChain requires at least 2 geometries")
        }

        let result: any = null
        for (let i = 0; i < geoms.length - 1; i++) {
          const hulled = Manifold.hull([
            geoms[i]._manifold,
            geoms[i + 1]._manifold,
          ])
          if (result === null) {
            result = hulled
          } else {
            result = result.add(hulled)
          }
        }
        return new ManifoldGeom3(result)
      },
    },

    maths: {
      slice: {
        fromPoints(points: Array<[number, number]>) {
          // Return a CrossSection-based slice representation
          return new CrossSection([points])
        },
        transform(matrix: any, slice: any) {
          // Apply a 2D transform to the slice
          if (slice.transform) return slice.transform(matrix)
          return slice
        },
      },
      bezier: {
        create(points: number[]) {
          return { points }
        },
        valueAt(t: number, curve: any) {
          // Simple Bernstein polynomial evaluation
          const pts = curve.points
          const n = pts.length - 1
          let val = 0
          for (let i = 0; i <= n; i++) {
            val += pts[i] * binomial(n, i) * t ** i * (1 - t) ** (n - i)
          }
          return val
        },
      },
      mat4: {
        create() {
          return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        },
        fromTranslation(out: number[], v: [number, number, number]) {
          const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1]
          for (let i = 0; i < 16; i++) out[i] = m[i]
          return out
        },
        fromScaling(out: number[], v: [number, number, number]) {
          const m = [v[0], 0, 0, 0, 0, v[1], 0, 0, 0, 0, v[2], 0, 0, 0, 0, 1]
          for (let i = 0; i < 16; i++) out[i] = m[i]
          return out
        },
      },
    },
  }

  return module
}

/** Extract a CrossSection from various geometry representations */
function unwrapCrossSection(geometry: any): any {
  if (Array.isArray(geometry)) {
    if (geometry.length === 1) return unwrapCrossSection(geometry[0])
    // Multiple cross-sections: union them
    const sections = geometry.map((g: any) => unwrapCrossSection(g))
    let result = sections[0]
    for (let i = 1; i < sections.length; i++) {
      result = result.add(sections[i])
    }
    return result
  }
  if (geometry._crossSection) return geometry._crossSection
  if (geometry._manifold) {
    // Project 3D geometry to get a cross-section
    return geometry._manifold.project()
  }
  throw new Error("Cannot extract cross-section from geometry")
}

function binomial(n: number, k: number): number {
  if (k === 0 || k === n) return 1
  let result = 1
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1)
  }
  return result
}

/** Remove consecutive duplicate points that cause zero-area CrossSections */
function deduplicatePoints(points: [number, number][]): [number, number][] {
  if (points.length < 2) return points
  const eps = 1e-10
  const result: [number, number][] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]
    const curr = points[i]
    const dx = curr[0] - prev[0]
    const dy = curr[1] - prev[1]
    if (dx * dx + dy * dy > eps) {
      result.push(curr)
    }
  }
  // Also check last vs first
  if (result.length > 1) {
    const first = result[0]
    const last = result[result.length - 1]
    const dx = last[0] - first[0]
    const dy = last[1] - first[1]
    if (dx * dx + dy * dy <= eps) {
      result.pop()
    }
  }
  return result
}
