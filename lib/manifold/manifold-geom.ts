/**
 * Wrapper classes that hold manifold/cross-section geometry and lazily convert
 * to jscad-compatible polygon/sides format for rendering.
 *
 * This allows the existing convertCSGToThreeGeom converter to work unchanged.
 */

/** Wrapper for 3D manifold geometry */
export class ManifoldGeom3 {
  _manifold: any
  _color?: [number, number, number]
  _polygonsCache?: any[]

  constructor(manifold: any, color?: [number, number, number]) {
    this._manifold = manifold
    this._color = color
  }

  /** Lazy getter that converts manifold mesh to jscad-compatible polygon format */
  get polygons() {
    if (this._polygonsCache) return this._polygonsCache
    const mesh = this._manifold.getMesh()
    const numProp = mesh.numProp
    const polygons: any[] = []

    for (let i = 0; i < mesh.numTri; i++) {
      const v0 = mesh.triVerts[i * 3]
      const v1 = mesh.triVerts[i * 3 + 1]
      const v2 = mesh.triVerts[i * 3 + 2]

      polygons.push({
        vertices: [
          [
            mesh.vertProperties[v0 * numProp],
            mesh.vertProperties[v0 * numProp + 1],
            mesh.vertProperties[v0 * numProp + 2],
          ],
          [
            mesh.vertProperties[v1 * numProp],
            mesh.vertProperties[v1 * numProp + 1],
            mesh.vertProperties[v1 * numProp + 2],
          ],
          [
            mesh.vertProperties[v2 * numProp],
            mesh.vertProperties[v2 * numProp + 1],
            mesh.vertProperties[v2 * numProp + 2],
          ],
        ],
      })
    }

    this._polygonsCache = polygons
    return polygons
  }

  /** Identity transform — manifold already applies transforms internally */
  get transforms() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  get color() {
    return this._color
  }

  withColor(color: [number, number, number]): ManifoldGeom3 {
    return new ManifoldGeom3(this._manifold, color)
  }
}

/** Wrapper for 2D cross-section geometry */
export class ManifoldGeom2 {
  _crossSection: any
  _color?: [number, number, number]
  _sidesCache?: any[]

  constructor(crossSection: any, color?: [number, number, number]) {
    this._crossSection = crossSection
    this._color = color
  }

  /** Lazy getter that converts cross-section to jscad-compatible sides format */
  get sides() {
    if (this._sidesCache) return this._sidesCache
    const polygons = this._crossSection.toPolygons()
    const sides: [number, number][][] = []

    for (const polygon of polygons) {
      for (let i = 0; i < polygon.length; i++) {
        const next = (i + 1) % polygon.length
        sides.push([
          [polygon[i][0], polygon[i][1]],
          [polygon[next][0], polygon[next][1]],
        ])
      }
    }

    this._sidesCache = sides
    return sides
  }

  get transforms() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  get color() {
    return this._color
  }

  withColor(color: [number, number, number]): ManifoldGeom2 {
    return new ManifoldGeom2(this._crossSection, color)
  }
}
