import { Slot } from '../context';
import { HandleProps, HandleType, Position } from '@xyflow/react';

export default class SlotHandle extends Slot implements HandleProps {
  type: HandleType;

  position: Position;

  constructor(name: string, options: HandleProps) {
    super(name);
    this.type = options.type;
    this.position = options.position;
  }
}
