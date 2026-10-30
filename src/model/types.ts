export type NodeId = string;

export type NodeType = 'frame' | 'group' | 'rect' | 'ellipse' | 'line' | 'text';

/** CSS color string, or `null` for "none". */
export type Paint = string | null;

interface BaseNode {
  readonly id: NodeId;
  type: NodeType;
  name: string;
  /** Position of the node's top-left corner in its parent's coordinate space. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation in radians, clockwise on screen, about the node's top-left corner. */
  rotation: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  fill: Paint;
  stroke: Paint;
  strokeWidth: number;
  /** Parent id; `null` only for the document root. */
  parentId: NodeId | null;
  /** Child ids in paint order (first = bottom). Empty for leaf nodes. */
  children: NodeId[];
}

export interface FrameNode extends BaseNode {
  type: 'frame';
  cornerRadius: number;
  clip: boolean;
}
export interface GroupNode extends BaseNode {
  type: 'group';
}
export interface RectNode extends BaseNode {
  type: 'rect';
  cornerRadius: number;
}
export interface EllipseNode extends BaseNode {
  type: 'ellipse';
}
/** A line from (0,0) to (width,height) in local space; width/height may be zero. */
export interface LineNode extends BaseNode {
  type: 'line';
}
export interface TextNode extends BaseNode {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
}

export type SceneNode = FrameNode | GroupNode | RectNode | EllipseNode | LineNode | TextNode;

export const CONTAINER_TYPES: ReadonlySet<NodeType> = new Set(['frame', 'group']);
