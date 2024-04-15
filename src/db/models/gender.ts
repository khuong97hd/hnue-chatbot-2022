import { Schema, Document, model } from 'mongoose';
import GenderEnum from '../../enums/GenderEnum';

const GenderSchema: Schema = new Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  gender: {
    type: String,
    enum: Object.keys(GenderEnum),
    required: true,
  },
  name: {
    type: String,
    required: false,
  },
  money: {
    type: Number,
    required: false,
    default: 0,
  },
  time_get_money: {
    type: Date,
    required: false,
    default: Date.now,
  },
  time: {
    type: Date,
    required: false,
    default: Date.now,
  },
});

export interface GenderProp extends Document {
  id: string;
  name: string;
  money: number;
  time_get_money: Date;
  time: Date;
  gender: GenderEnum;
}

export default model<GenderProp>('gender', GenderSchema);
