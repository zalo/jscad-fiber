/**
 * Creates a JSCADModule-compatible adapter backed by manifold-3d via
 * @basefold/sketch. No manifold-3d import needed — basefold-sketch
 * handles WASM loading internally.
 */

import { createJscadModule } from "@basefold/sketch"

export async function createManifoldModule() {
  return createJscadModule()
}
