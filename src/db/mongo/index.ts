/**
 * Methods for writing to MongoDB
 * @packageDocumentation
 */

import { Mutex } from 'async-mutex';

import ChatRoom from '../models/chatroom';
import WaitRoom from '../models/waitroom';
import Gender from '../models/gender';
import LastPerson from '../models/lastperson';
import GenderEnum from '../../enums/GenderEnum';
import logger from '../../utils/logger';
import MegaHash from 'megahash';
import { ChatRoomEntry, WaitRoomEntry, GenderEntry, LastPersonEntry,UserProfileResponseEntry } from '../../interfaces/DatabaseEntry';

/**
 * `findOneAndUpdate` with `upsert` is not atomic.
 * We lock Mongo so that only one operation is allowed at a time.
 */
const mongoMutex = new Mutex();

/**
 * Save gender to database
 * @param id - ID of user
 * @param gender - Gender of user
 */
const genderWrite = async (id: string, gender: GenderEnum): Promise<void> => {
  const release = await mongoMutex.acquire();
  try {
    await Gender.findOneAndUpdate({ id }, { $set: { gender } }, { upsert: true });
  } catch (err) {
    logger.logError('mongo::genderWrite', 'Failed to save data to MongoDB', err, true);
  } finally {
    release();
  }
};

/**
 * Get gender of user
 * Return `null` if not available.
 * @param id - ID of user
 */
const genderCacheMutex = new Mutex();
const genderCache = new MegaHash();
const findUserData = async (id: string): Promise<UserProfileResponseEntry> => {
  let ret: UserProfileResponseEntry | null = null;

  const release = await genderCacheMutex.acquire();
  try {
    ret = genderCache.has(id) ? genderCache.get(id) : null;
  } catch (err) {
    logger.logError('cache::genderFind', 'This should never happen', err, true);
  } finally {
    release();
  }

  return ret as UserProfileResponseEntry;
};

/**
 * Add user to wait room
 * @param id - ID of user
 * @param gender - Gender of user
 */
const waitRoomWrite = async (id: string, gender: GenderEnum, time: Date): Promise<void> => {
  const release = await mongoMutex.acquire();
  try {
    await WaitRoom.findOneAndUpdate({ id }, { $set: { gender, time } }, { upsert: true });
  } catch (err) {
    logger.logError('mongo::waitRoomWrite', 'Failed to save data to MongoDB', err, true);
  } finally {
    release();
  }
};

/**
 * Remove user from wait room
 * @param id - ID of user
 */
const waitRoomRemove = async (id: string): Promise<void> => {
  const release = await mongoMutex.acquire();
  try {
    await WaitRoom.deleteOne({ id });
  } catch (err) {
    logger.logError('mongo::waitRoomRemove', 'Failed to save data to MongoDB', err, true);
  } finally {
    release();
  }
};

/**
 * Add paired users to chat room
 * @param id1 - ID of first user
 * @param id2 - ID of second user
 * @param gender1 - Gender of first user
 * @param gender2 - Gender of second user
 * @param time - Time when paired
 */
const chatRoomWrite = async (
  id1: string,
  id2: string,
  gender1: GenderEnum,
  gender2: GenderEnum,
  time: Date,
): Promise<void> => {
  const release = await mongoMutex.acquire();
  try {
    await ChatRoom.findOneAndUpdate({ id1 }, { $set: { id2, gender1, gender2, time } }, { upsert: true });
  } catch (err) {
    logger.logError('mongo::chatRoomWrite', 'Failed to save data to MongoDB', err, true);
  } finally {
    release();
  }
};

/**
 * Remove paired users from chat room
 * @param id - ID of one of two user
 */
const chatRoomRemove = async (id: string): Promise<void> => {
  const release = await mongoMutex.acquire();
  try {
    await ChatRoom.deleteOne({ $or: [{ id1: id }, { id2: id }] });
  } catch (err) {
    logger.logError('mongo::chatRoomRemove', 'Failed to save data to MongoDB', err, true);
  } finally {
    release();
  }
};

/**
 * Set `user2` as the last person paired with `user1`
 * @param id1 - ID of `user1`
 * @param id2 - ID of `user2`
 */
const lastPersonWrite = async (id1: string, id2: string): Promise<void> => {
  const release = await mongoMutex.acquire();
  try {
    await LastPerson.findOneAndUpdate({ id1 }, { $set: { id2 } }, { upsert: true });
  } catch (err) {
    logger.logError('db::updateLastPerson', 'Failed to save data to MongoDB', err, true);
  } finally {
    release();
  }
};

/**
 * Delete everything in database
 */
const resetDatabase = async (): Promise<void> => {
  const release = await mongoMutex.acquire();

  try {
    await ChatRoom.deleteMany({});
  } catch (err) {
    logger.logError('mongo::resetDatabase::chatRoom', 'Failed to save data to MongoDB', err, true);
  }

  try {
    await WaitRoom.deleteMany({});
  } catch (err) {
    logger.logError('mongo::resetDatabase::waitRoom', 'Failed to save data to MongoDB', err, true);
  }

  try {
    await Gender.deleteMany({});
  } catch (err) {
    logger.logError('mongo::resetDatabase::gender', 'Failed to save data to MongoDB', err, true);
  }

  try {
    await LastPerson.deleteMany({});
  } catch (err) {
    logger.logError('mongo::resetDatabase::lastPerson', 'Failed to save data to MongoDB', err, true);
  }

  release();
};

export default {
  genderWrite,
  waitRoomWrite,
  waitRoomRemove,
  chatRoomWrite,
  chatRoomRemove,
  lastPersonWrite,
  resetDatabase,
  findUserData
};
