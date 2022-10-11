## PTNK Chatible

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

#### Chatible clone written in TypeScript, based on Node, Express and Mongo

Demo: https://m.me/hnuechatbot

## Cài đặt

- Deploy to Heroku
- Tạo db và public whitelist IP trên mongoDB : https://cloud.mongodb.com/  , copy MONGO_URI để set biến ở bước sau
- Set Config Vars : PAGE_ACCESS_TOKEN, PAGE_VERIFY_TOKEN, APP_SECRET, HEROKU_API_KEY, MONGO_URI : "mongodb+srv://cuccu9xx:cuccu9xx@cluster0.xx5hg.mongodb.net/test?retryWrites=true&w=majority"
- Cài đặt Heroku CLI xem log khi build xem có lỗi không 
    - heroku login 
    - xem log heroku logs --tail -a tenappheroku
- Lên https://developers.facebook.com/ tạo app facebook
    - Vào Cài đặt > thông tin cơ bản : lấy mã bí mật của app ( APP_SECRET )
    - Vào messenger > Mã truy cập > Chọn page chat bot > Tạo mã token > PAGE_ACCESS_TOKEN
    - Vào messenger > webhooks > set url gọi lại : https://hnue-chatbot-2022.herokuapp.com/webhook , Mã xác minh : PAGE_VERIFY_TOKEN (khớp nhau là được)
    - Vào messenger > Trang > Page chatbot > tích 2 tính năng messages, messaging_postbacks
    - Vào webhook > page > messenger > subcribe và test send mess > check log heroku cli
- Xin quyền để chuyển lên product app
## Basic instruction

- Deploy to Heroku using the deploy button.
- Create a cluster on MongoDB Atlas. Whitelist IP addresses.
- Create an app on Facebook. Install Webhook. Get app secret and tokens.
- Set Heroku's `Config Vars`. Check [.env.example](.env.example) to know which variables you need to set.
- Enjoy!

## Features

- Admin dashboard ([code](https://github.com/ptnkchat/ptnkchat.github.io))
- Pair by gender (e.g. male with female)
- Send cute dog/cat pictures
- Customizable message templates
- Cache database in memory to increase performance
- Developed with performance in mind

## Planned features

- Allow editing profile via Messenger Webview
- Limiting rate of requests sent out to avoid being converted to [high-MPS](https://developers.facebook.com/docs/messenger-platform/send-messages/high-mps) page

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

## Credit

- Nguyen Xuan Son (a.k.a Nui or [@ngxson](https://github.com/ngxson)) for [Chatbot CHN](https://github.com/ngxson/chatbot-cnh) on which this project was originally based
- Duong Van Khuong (a.k.a Nui or [@khuong97](https://github.com/khuong97hd)) for [Chatbot HNUE](https://github.com/khuong97hd/hnue-chatbot-2022) on which this project was originally based
- Le Bao Hiep ([@hieplpvip](https://github.com/hieplpvip)) for maintaining this project
