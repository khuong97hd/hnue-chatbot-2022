/**
 * CHATIBLE implementation (aka the most important part of this project).
 * @packageDocumentation
 */

import db from '../db';
import lang from '../lang';
import config from '../config';

import fb from '../utils/facebook';
import logger from '../utils/logger';
import gifts from '../utils/gifts';

import GenderEnum from '../enums/GenderEnum';
import { WebhookMessagingEvent, WebhookMessageObject } from '../interfaces/FacebookAPI';
import {
    SendRequest,
    SendMessageObject,
    SendQuickReply,
    SendResponse,
    MessengerProfileResponse,
    UserProfileResponse,
    GetPersonasResponse,
    PostPersonasResponse,
} from '../interfaces/FacebookAPI';
import { ChatRoomEntry, WaitRoomEntry, GenderEntry, LastPersonEntry, UserProfileResponseEntry } from '../interfaces/DatabaseEntry';

/**
 * Parse string to get gender
 * @param genderString - String to parse
 * @returns Parsed gender
 */
const parseGender = (genderString: string): GenderEnum | null => {
    let res: GenderEnum | null;
    if (genderString === lang.KEYWORD_GENDER + lang.KEYWORD_GENDER_MALE) {
        res = GenderEnum.FEMALE;
    } else if (genderString === lang.KEYWORD_GENDER + lang.KEYWORD_GENDER_FEMALE) {
        res = GenderEnum.MALE;
    } else if (genderString === lang.KEYWORD_GENDER + lang.KEYWORD_GENDER_BOTH) {
        res = GenderEnum.UNKNOWN;
    } else {
        res = null;
    }
    return res;
};

/**
 * Get gender of user from database if available.
 * Otherwise, get it from Facebook.
 * @param id - ID of user
 * @returns Gender of user
 */
const getGender = async (id: string): Promise<GenderEnum> => {
    let gender: GenderEnum | null = await db.getGender(id);
    if (gender) {
        return gender;
    }

    // not found in database, fetch from facebook
    const data = await fb.getUserData(id);
    if (data.error || !data.gender) {
        gender = GenderEnum.UNKNOWN;
    } else if (data.gender === 'male') {
        gender = GenderEnum.MALE;
    } else if (data.gender === 'female') {
        gender = GenderEnum.FEMALE;
    }

    await db.setGender(id, gender as GenderEnum);
    return gender as GenderEnum;
};

/**
 * Connect two users and add them to chat room
 * @param id1 - ID of first user
 * @param id2 - ID of second user
 * @param gender1 - Gender of first user
 * @param gender2 - Gender of second user
 */
const pairPeople = async (id1: string, id2: string, gender1: GenderEnum, gender2: GenderEnum): Promise<void> => {
    await db.removeFromWaitRoom(id1);
    await db.removeFromWaitRoom(id2);
    await db.writeToChatRoom(id1, id2, gender1, gender2);
    await db.updateLastPerson(id1, id2);
    await db.updateLastPerson(id2, id1);
    await fb.sendTextMessage('', id1, lang.CONNECTED + '👉 ID của bạn : ' + id1 + '\n👉 ID của đối : ' + id2, false);
    await fb.sendTextMessage('', id2, lang.CONNECTED + '👉 ID của bạn : ' + id2 + '\n👉 ID của đối : ' + id1, false);
    await logger.logPair(id1, id2);
};

/**
 * Find a user in wait room to match with new user.
 * If found, pair them. Otherwise, add new user to wait room.
 * @param id - ID of new user
 * @param myGender - Gender of new user
 */
const findPair = async (id: string, myGender: GenderEnum): Promise<void> => {
    const waitRoomList = await db.getListWaitRoom();

    for (const entry of waitRoomList) {
        const target = entry.id;
        const targetGender = entry.gender;

        // check if they have just been paired
        if ((await db.checkLastPerson(id, target)) || (await db.checkLastPerson(target, id))) {
            continue;
        }

        // pair if genders match
        // or there are too many people in wait room
        // or gender of one of them is unknown (with probability 0.2)

        const isPreferredGender =
            (myGender === GenderEnum.UNKNOWN && targetGender === GenderEnum.UNKNOWN) ||
            (myGender === GenderEnum.MALE && targetGender === GenderEnum.FEMALE) ||
            (myGender === GenderEnum.FEMALE && targetGender === GenderEnum.MALE);

        if (
            isPreferredGender ||
            waitRoomList.length > config.MAX_PEOPLE_IN_WAITROOM ||
            ((myGender === GenderEnum.UNKNOWN || targetGender === GenderEnum.UNKNOWN) && Math.random() > 0.8)
        ) {
            await pairPeople(id, target, myGender, targetGender);
            return;
        }
    }

    // found no match, put in wait room
    await db.writeToWaitRoom(id, myGender);

    if (myGender === GenderEnum.UNKNOWN) {
        await fb.sendTextMessage('', id, lang.START_WARN_GENDER, false);
    }
    await fb.sendTextMessage('', id, lang.START_OKAY, false);
};

/**
 * Disconnect paired users
 * @param id1 - ID of first user
 * @param id2 - ID of second user
 */
const processEndChat = async (id1: string, id2: string): Promise<void> => {
    await db.removeFromChatRoom(id1); // or await db.removeFromChatRoom(id2);
    await fb.sendTextButtons(id1, lang.END_CHAT, true, true, true, true, false);
    await fb.sendTextButtons(id2, lang.END_CHAT_PARTNER, true, true, true, true, false);
};

/**
 * Forward message from sender to receiver
 * @param sender - ID of sender
 * @param receiver - ID of receiver
 * @param data - Message data to forward
 */
const forwardMessage = async (sender: string, receiver: string, data: WebhookMessageObject): Promise<void> => {
    if (data.attachments) {
        if (data.attachments[0]) {
            const type = data.attachments[0].type;
            if (type === 'fallback') {
                let text: string;
                if (data.text) {
                    text = data.text;
                } else {
                    text = lang.ATTACHMENT_LINK + data.attachments[0].payload.url;
                }
                await fb.sendTextMessage(sender, receiver, text, true);
            } else if (type === 'image' || type === 'video' || type === 'audio' || type === 'file') {
                await fb.sendAttachment(sender, receiver, type, data.attachments[0].payload.url, false, false, true);
            } else {
                await fb.sendTextMessage('', sender, lang.ERR_ATTACHMENT, false);
                return;
            }
        }

        for (let i = 1; i < data.attachments.length; i++) {
            const type = data.attachments[i].type;
            if (type === 'image' || type === 'video' || type === 'audio' || type === 'file') {
                await fb.sendAttachment(sender, receiver, type, data.attachments[i].payload.url, false, false, true);
            }
        }
    } else {
        await fb.sendTextMessage(sender, receiver, data.text, true);
    }
};

/**
 * Get thông tin user data
 * Otherwise, get it from Facebook.
 * @param id - ID of user
 * @returns Gender of user
 */
const getPersonalInfo = async (id: string): Promise<UserProfileResponseEntry> => {
    try {
        let user_data: UserProfileResponseEntry | null = await db.getUserData(id);
        return user_data as UserProfileResponseEntry;
    } catch (err) {
        logger.logError('facebook::getUserData', 'Failed to send request to database', err, true);
        return {};
    }

    // not found in database, fetch from facebook
    // const user_data_facebook = await fb.getUserData(id);

    // return user_data as UserProfileResponseEntry;
};

/**
 * Process messaging event sent by Facebook
 * @param event - Messaging event
 */
const processEvent = async (event: WebhookMessagingEvent): Promise<void> => {
    if (event.read) {
        event.message = { text: '' };
    }

    if (event.postback && event.postback.payload) {
        event.message = { text: event.postback.payload };
    }

    if (!event.hasOwnProperty('message') || event.delivery) {
        return;
    }

    if (event.message.is_echo === true) {
        return;
    }

    // ID của người gửi tới page
    const sender: string = event.sender.id;
    // user data
    // const user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
    // let time_get_money_convert = formatDate(String(user_data.time_get_money), 0);
    // let time_get_money_convert_next = formatDate(String(user_data.time_get_money), 24);

    if (config.MAINTENANCE) {
        await fb.sendTextMessage('', sender, lang.MAINTENANCE, false);
        return;
    }

    // Nhận lệnh từ người gửi
    let text = '';
    if (event.message.quick_reply && event.message.quick_reply.payload) {
        text = event.message.quick_reply.payload;
    } else if (event.message.text) {
        text = event.message.text;
    }

    let command = '';
    if (text.length < 20) {
        command = text.toLowerCase().replace(/ /g, '');
    }

    if (command === 'ʬ') {
        await fb.sendTextButtons(sender, lang.FIRST_COME, true, false, true, true, false);
        return;
    }

    // fetch person state
    const waitState: boolean = await db.isInWaitRoom(sender);
    const sender2: string | null = await db.findPartnerChatRoom(sender);

    if (!waitState && sender2 === null) {
        // neither in chat room nor wait room
        if (command === lang.KEYWORD_START) {
            // nếu bấm 'batdau', sẽ set giới tính theo id trong db, nếu db không có thì call api get giới tính của fb
            const gender: GenderEnum = await getGender(sender);
            await findPair(sender, gender);
        }
        // nếu bấm 'tìm', nếu tìm nữ -> set giới tính : nam, tìm nam -> set giới tính : nữ
        else if (command.startsWith(lang.KEYWORD_GENDER)) {
            const gender: GenderEnum | null = parseGender(command);
            if (gender === null) {
                await fb.sendTextButtons(sender, lang.GENDER_ERR, false, false, true, true, false);
            } else {
                let genderString = '';
                if (gender === GenderEnum.MALE) {
                    genderString = lang.GENDER_ARR_FEMALE;
                } else if (gender === GenderEnum.FEMALE) {
                    genderString = lang.GENDER_ARR_MALE;
                }
                else if (gender === GenderEnum.UNKNOWN) {
                    genderString = lang.GENDER_ARR_UNKNOWN;
                }

                // if (gender !== GenderEnum.UNKNOWN) {
                // await fb.sendTextMessage('', sender, lang.GENDER_WRITE_OK + genderString + lang.GENDER_WRITE_WARN, false);
                await fb.sendTextMessage('', sender, lang.GENDER_WRITE_OK + genderString, false);
                // }

                await db.setGender(sender, gender);
                await findPair(sender, gender);
            }
        } else if (command === lang.KEYWORD_HELP) {
            await fb.sendTextButtons(sender, lang.HELP_TXT, true, false, true, true, false);
        } else if (command === lang.KEYWORD_DONATE) {
            await fb.sendTextButtons(sender, lang.DONATE_TXT, true, false, true, true, false);
        } else if (command === lang.KEYWORD_CAT) {
            await gifts.sendCatPic(sender, null);
        } else if (command === lang.KEYWORD_DOG) {
            await gifts.sendDogPic(sender, null);
        } else if (command === lang.KEYWORD_HOTBOY) {
            await gifts.sendHotBoyPic(sender, null);
        } 
        // check thông tin cá nhân
        else if (command === lang.KEYWORD_PERSONAL_INFO) {
            let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
            let time_get_money_convert = formatDate(String(user_data.time_get_money), 0);
            let time_get_money_convert_next = formatDate(String(user_data.time_get_money), 24);
            await fb.sendPersonalInfoButtons(sender, '👉 ID: ' + user_data.id + '\n💸 Xu: ' + user_data.money + '\n⏰ Đã nhận lúc: ' + time_get_money_convert + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next, true);
            // await fb.sendPersonalInfoButtons(sender, '👉 ID: ' + user_data.id + '\n💸 Xu: ' + user_data.money + '\n⏰ Đã nhận lúc: ' + user_data.time_get_money + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next, true);
        }
        // Get money daily
        else if (command === lang.KEYWORD_GET_MONEY_DAILY) {
            let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
            if (isCurrentTimeGreaterThan24Hours(String(user_data.time_get_money))) {
                let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
                let time_get_money_convert = formatDate(String(user_data.time_get_money), 0);
                let time_get_money_convert_next = formatDate(String(user_data.time_get_money), 24);
                await db.getMoneyDaily(sender, user_data.money ? user_data.money : 0);
                let user_data_reload: UserProfileResponseEntry = await getPersonalInfo(sender);
                let time_get_money_convert_reload = formatDate(String(user_data_reload.time_get_money), 0);
                let time_get_money_convert_next_reload = formatDate(String(user_data_reload.time_get_money), 24);
                await fb.sendTextMessage('', sender, '✅ Chúc mừng, bạn đã nhận được thêm 1 xu !' + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next_reload, false);
                await fb.sendPersonalInfoButtons(sender, '👉 ID: ' + user_data_reload.id + '\n💸 Xu: ' + user_data_reload.money + '\n⏰ Đã nhận lúc: ' + time_get_money_convert_reload + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next_reload, true);
            } else {
                let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
                let time_get_money_convert = formatDate(String(user_data.time_get_money), 0);
                let time_get_money_convert_next = formatDate(String(user_data.time_get_money), 24);
                await fb.sendTextMessage('', sender, '❌ Bạn đã điểm danh ngày hôm nay, hãy quay lại vào ngày mai !' + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next, false);
            }
        } else if (!event.read) {
            await fb.sendTextButtons(sender, lang.INSTRUCTION, true, false, true, true, false);
        }

    } else if (waitState && sender2 === null) {
        // in wait room and waiting
        if (command === lang.KEYWORD_END) {
            await db.removeFromWaitRoom(sender);
            await fb.sendTextButtons(sender, lang.END_CHAT, true, false, true, true, false);
        } else if (command === lang.KEYWORD_HELP) {
            await fb.sendTextButtons(sender, lang.HELP_TXT, false, false, true, false, false);
        } else if (command === lang.KEYWORD_DONATE) {
            await fb.sendTextButtons(sender, lang.DONATE_TXT, true, false, true, true, false);
        } else if (command === lang.KEYWORD_CAT) {
            await gifts.sendCatPic(sender, null);
        } else if (command === lang.KEYWORD_DOG) {
            await gifts.sendDogPic(sender, null);
        } else if (command === lang.KEYWORD_HOTBOY) {
            await gifts.sendHotBoyPic(sender, null);
        } 
        // check thông tin cá nhân
        else if (command === lang.KEYWORD_PERSONAL_INFO) {
            let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
            let time_get_money_convert = formatDate(String(user_data.time_get_money), 0);
            let time_get_money_convert_next = formatDate(String(user_data.time_get_money), 24);
            await fb.sendPersonalInfoButtons(sender, '👉 ID: ' + user_data.id + '\n💸 Xu: ' + user_data.money + '\n⏰ Đã nhận lúc: ' + time_get_money_convert + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next, true);
            // await fb.sendPersonalInfoButtons(sender, '👉 ID: ' + user_data.id + '\n💸 Xu: ' + user_data.money + '\n⏰ Đã nhận lúc: ' + user_data.time_get_money + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next, true);
        }
        // Get money daily
        else if (command === lang.KEYWORD_GET_MONEY_DAILY) {
            let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
            if (isCurrentTimeGreaterThan24Hours(String(user_data.time_get_money))) {
                let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
                let time_get_money_convert = formatDate(String(user_data.time_get_money), 0);
                let time_get_money_convert_next = formatDate(String(user_data.time_get_money), 24);
                await db.getMoneyDaily(sender, user_data.money ? user_data.money : 0);
                let user_data_reload: UserProfileResponseEntry = await getPersonalInfo(sender);
                let time_get_money_convert_reload = formatDate(String(user_data_reload.time_get_money), 0);
                let time_get_money_convert_next_reload = formatDate(String(user_data_reload.time_get_money), 24);
                await fb.sendTextMessage('', sender, '✅ Chúc mừng, bạn đã nhận được thêm 1 xu !' + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next_reload, false);
                await fb.sendPersonalInfoButtons(sender, '👉 ID: ' + user_data_reload.id + '\n💸 Xu: ' + user_data_reload.money + '\n⏰ Đã nhận lúc: ' + time_get_money_convert_reload + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next_reload, true);
            } else {
                let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
                let time_get_money_convert = formatDate(String(user_data.time_get_money), 0);
                let time_get_money_convert_next = formatDate(String(user_data.time_get_money), 24);
                await fb.sendTextMessage('', sender, '❌ Bạn đã điểm danh ngày hôm nay, hãy quay lại vào ngày mai !' + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next, false);
            }
        }
        else if (!event.read) {
            await fb.sendTextButtons(sender, lang.WAITING, false, false, true, false, false);
        }
    } else if (!waitState && sender2 !== null) {
        // in chat room
        if (command === lang.KEYWORD_END) {
            await fb.sendAcceptExitButtons(sender, lang.KEYWORD_YES_NO_END, true);
        }
        else if (command === lang.KEYWORD_ACCEPT_END) {
            await processEndChat(sender, sender2);
        }
        else if (command === lang.KEYWORD_START) {
            await fb.sendTextMessage('', sender, lang.START_ERR_ALREADY, false);
        } else if (command === lang.KEYWORD_HELP) {
            await fb.sendTextButtons(sender, lang.HELP_TXT, false, true, true, false, false);
        } else if (command === lang.KEYWORD_DONATE) {
            await fb.sendTextButtons(sender, lang.DONATE_TXT, true, false, true, true, false);
        } else if (command === lang.KEYWORD_CAT) {
            await forwardMessage(sender, sender2, event.message);
            await gifts.sendCatPic(sender, sender2);
        } else if (command === lang.KEYWORD_DOG) {
            await forwardMessage(sender, sender2, event.message);
            await gifts.sendDogPic(sender, sender2);
        } else if (command === lang.KEYWORD_HOTBOY) {
            await forwardMessage(sender, sender2, event.message);
            await gifts.sendHotBoyPic(sender, sender2);
        }
        // check thông tin cá nhân
        else if (command === lang.KEYWORD_PERSONAL_INFO) {
            let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
            let time_get_money_convert = formatDate(String(user_data.time_get_money), 0);
            let time_get_money_convert_next = formatDate(String(user_data.time_get_money), 24);
            await fb.sendPersonalInfoButtons(sender, '👉 ID: ' + user_data.id + '\n💸 Xu: ' + user_data.money + '\n⏰ Đã nhận lúc: ' + time_get_money_convert + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next, true);
            // await fb.sendPersonalInfoButtons(sender, '👉 ID: ' + user_data.id + '\n💸 Xu: ' + user_data.money + '\n⏰ Đã nhận lúc: ' + user_data.time_get_money + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next, true);
        }
        // Get money daily
        else if (command === lang.KEYWORD_GET_MONEY_DAILY) {
            let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
            if (isCurrentTimeGreaterThan24Hours(String(user_data.time_get_money))) {
                let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
                let time_get_money_convert = formatDate(String(user_data.time_get_money), 0);
                let time_get_money_convert_next = formatDate(String(user_data.time_get_money), 24);
                await db.getMoneyDaily(sender, user_data.money ? user_data.money : 0);
                let user_data_reload: UserProfileResponseEntry = await getPersonalInfo(sender);
                let time_get_money_convert_reload = formatDate(String(user_data_reload.time_get_money), 0);
                let time_get_money_convert_next_reload = formatDate(String(user_data_reload.time_get_money), 24);
                await fb.sendTextMessage('', sender, '✅ Chúc mừng, bạn đã nhận được thêm 1 xu !' + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next_reload, false);
                await fb.sendPersonalInfoButtons(sender, '👉 ID: ' + user_data_reload.id + '\n💸 Xu: ' + user_data_reload.money + '\n⏰ Đã nhận lúc: ' + time_get_money_convert_reload + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next_reload, true);
            } else {
                let user_data: UserProfileResponseEntry = await getPersonalInfo(sender);
                let time_get_money_convert = formatDate(String(user_data.time_get_money), 0);
                let time_get_money_convert_next = formatDate(String(user_data.time_get_money), 24);
                await fb.sendTextMessage('', sender, '❌ Bạn đã điểm danh ngày hôm nay, hãy quay lại vào ngày mai !' + '\n⏳ Lượt tiếp theo: ' + time_get_money_convert_next, false);
            }
        }
        else {
            // FIX-ME: Only send seen indicator for messages before watermark
            if (event.read) {
                await fb.sendSeenIndicator(sender2);
            } else if (text.trim().toLowerCase().startsWith('[bot]')) {
                await fb.sendTextMessage('', sender, lang.ERR_FAKE_MSG, false);
            } else {
                await forwardMessage(sender, sender2, event.message);
            }
        }
    } else {
        await db.removeFromWaitRoom(sender);
        await db.removeFromChatRoom(sender);
        await fb.sendTextMessage('', sender, lang.ERR_UNKNOWN, false);
    }
};

/**
 * Remove timeout users in wait room every minute.
 * Timeout is specified in config.
 */
const removeTimeoutUser = async (): Promise<void> => {
    const waitRoomList = await db.getListWaitRoom();

    const now = new Date();
    waitRoomList.forEach(async (entry) => {
        if (now.getTime() - entry.time.getTime() > config.MAX_WAIT_TIME_MINUTES * 60000) {
            await db.removeFromWaitRoom(entry.id);
            await fb.sendTextButtons(entry.id, lang.END_CHAT_FORCE, true, false, true, true, false);
        }
    });
};

// hàm chuyển đổi giờ sang dd/mm/yyyy hh:mm:ss
function formatDate(input: string, addHours: number): string {
    const date = new Date(input);
    const adjustedDate = new Date(date.getTime() + ((7 + addHours) * 3600000)); // 7 giờ = 7 * 3600 * 1000 milliseconds

    const day = String(adjustedDate.getDate()).padStart(2, '0');
    const month = String(adjustedDate.getMonth() + 1).padStart(2, '0');
    const year = adjustedDate.getFullYear();
    const hours = String(adjustedDate.getHours()).padStart(2, '0');
    const minutes = String(adjustedDate.getMinutes()).padStart(2, '0');
    const seconds = String(adjustedDate.getSeconds()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

// hàm tính toán chênh lệnh 2 ngày với nhau
function isCurrentTimeGreaterThan24Hours(inputDateString: string): boolean {
    // Chuyển đổi chuỗi đầu vào thành đối tượng Date
    const inputDate = new Date(inputDateString);
    // Lấy thời gian hiện tại
    const currentDate = new Date();

    // Thêm 24 giờ vào thời gian đầu vào
    const nextDayDate = new Date(inputDate.getTime() + (24 * 3600 * 1000));
    logger.logError('currentDate', 'currentDate', currentDate);
    logger.logError('nextDayDate', 'nextDayDate', nextDayDate);
    // So sánh thời gian hiện tại với thời gian đầu vào + 24 giờ
    return currentDate.getTime() >= nextDayDate.getTime();
}

export default {
    processEvent,
    removeTimeoutUser,
};
