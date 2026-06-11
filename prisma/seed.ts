import { PrismaClient, DriverType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const CITIES = ['宇都宮市', '栃木市', '小山市', '足利市', '佐野市', '鹿沼市', '日光市', '真岡市', '大田原市', '矢板市'];
const STORE_TYPES = ['店', 'センター', '工場', '営業所', '支店', '倉庫', '販売店'];
const STORE_NAMES = ['さくら', 'みどり', 'あおぞら', 'ひまわり', 'もみじ', 'うめ', 'たんぽぽ', 'すずらん', 'けやき', 'いちょう'];
const SURNAMES = ['佐藤', '鈴木', '高橋', '田中', '渡辺', '伊藤', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '清水', '斎藤'];
const TRUCK_MODELS = ['いすゞエルフ', '日野デュトロ', '三菱ふそうキャンター', 'UDコンドル', 'トヨタダイナ'];

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

async function main() {
  console.log('シードデータ作成を開始します...');

  // 管理者ユーザー
  const hashedPassword = await bcrypt.hash('admin1234', 10);
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      password: hashedPassword,
      name: '管理者',
      role: 'ADMIN',
    },
  });
  console.log('管理者ユーザー作成完了');

  // トラック15台
  for (let i = 1; i <= 15; i++) {
    const plateNo = `宇都宮 100 あ ${1000 + i}`;
    await prisma.truck.upsert({
      where: { plateNo },
      update: {},
      create: {
        plateNo,
        model: TRUCK_MODELS[randInt(0, TRUCK_MODELS.length - 1)],
        capacityKg: [2000, 3000, 4000, 6000][randInt(0, 3)],
        status: 'AVAILABLE',
      },
    });
  }
  console.log('トラック15台作成完了');

  // 専任ドライバー10名
  for (let i = 1; i <= 10; i++) {
    const licenseNo = `REG-${String(i).padStart(4, '0')}`;
    await prisma.driver.upsert({
      where: { licenseNo },
      update: {},
      create: {
        name: `${SURNAMES[i % SURNAMES.length]} 太郎${i}`,
        phone: `090-0000-${String(1000 + i)}`,
        type: DriverType.REGULAR,
        licenseNo,
        status: 'ACTIVE',
      },
    });
  }
  console.log('専任ドライバー10名作成完了');

  // スポットドライバー10名
  for (let i = 1; i <= 10; i++) {
    const licenseNo = `SPOT-${String(i).padStart(4, '0')}`;
    const driver = await prisma.driver.upsert({
      where: { licenseNo },
      update: {},
      create: {
        name: `${SURNAMES[(i + 10) % SURNAMES.length]} 次郎${i}`,
        phone: `080-0000-${String(2000 + i)}`,
        type: DriverType.SPOT,
        licenseNo,
        status: 'ACTIVE',
      },
    });

    // 今後30日のうちランダムに稼働日を登録
    const dates: Date[] = [];
    for (let d = 0; d < 30; d++) {
      if (Math.random() < 0.4) {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + d);
        dates.push(date);
      }
    }
    for (const date of dates) {
      await prisma.spotAvailability.upsert({
        where: { driverId_date: { driverId: driver.id, date } },
        update: {},
        create: { driverId: driver.id, date },
      });
    }
  }
  console.log('スポットドライバー10名作成完了');

  // 配送先500件
  const existingCount = await prisma.location.count();
  if (existingCount === 0) {
    const data = [];
    for (let i = 1; i <= 500; i++) {
      const city = CITIES[randInt(0, CITIES.length - 1)];
      const storeName = `${STORE_NAMES[randInt(0, STORE_NAMES.length - 1)]}${STORE_TYPES[randInt(0, STORE_TYPES.length - 1)]}${city}${i}号店`;
      const address = `栃木県${city}${randInt(1, 9)}丁目${randInt(1, 30)}番${randInt(1, 20)}号`;
      data.push({
        name: storeName,
        address,
        formattedAddress: address,
        phone: `028-${randInt(100, 999)}-${randInt(1000, 9999)}`,
        lat: randFloat(36.2, 36.9),
        lng: randFloat(139.5, 140.1),
        city,
      });
    }
    await prisma.location.createMany({ data });
    console.log('配送先500件作成完了');
  } else {
    console.log('配送先は既に登録済みのためスキップしました');
  }

  console.log('シードデータ作成が完了しました');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
