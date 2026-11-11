// Минимальная замена three/examples/jsm/utils/BufferGeometryUtils.js:
// GLTFLoader использует только toTrianglesDrawMode (для TRIANGLE_STRIP / TRIANGLE_FAN).
import { TriangleFanDrawMode, TriangleStripDrawMode, TrianglesDrawMode } from 'three';

export function toTrianglesDrawMode(geometry, drawMode) {
  if (drawMode === TrianglesDrawMode) return geometry;
  let index = geometry.getIndex();
  if (index === null) {
    const indices = [];
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) indices.push(i);
    geometry.setIndex(indices);
    index = geometry.getIndex();
  }
  const numberOfTriangles = index.count - 2;
  const newIndices = [];
  if (drawMode === TriangleFanDrawMode) {
    for (let i = 1; i <= numberOfTriangles; i++) newIndices.push(index.getX(0), index.getX(i), index.getX(i + 1));
  } else if (drawMode === TriangleStripDrawMode) {
    for (let i = 0; i < numberOfTriangles; i++) {
      if (i % 2 === 0) newIndices.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      else newIndices.push(index.getX(i + 2), index.getX(i + 1), index.getX(i));
    }
  } else {
    console.error('toTrianglesDrawMode: неизвестный режим', drawMode);
    return geometry;
  }
  const newGeometry = geometry.clone();
  newGeometry.setIndex(newIndices);
  newGeometry.clearGroups();
  return newGeometry;
}
