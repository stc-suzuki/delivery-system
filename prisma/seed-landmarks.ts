import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LANDMARKS = [
  { name: 'JR宇都宮駅', address: '栃木県宇都宮市川向町1-2', lat: 36.5594, lng: 139.8983 },
  { name: '宇都宮城址公園', address: '栃木県宇都宮市本丸町', lat: 36.5563, lng: 139.8868 },
  { name: '宇都宮市役所', address: '栃木県宇都宮市旭1-1-5', lat: 36.5512, lng: 139.8836 },
  { name: '栃木県庁', address: '栃木県宇都宮市塙田1-1-20', lat: 36.5610, lng: 139.8830 },
  { name: '宇都宮餃子館', address: '栃木県宇都宮市馬場通り4-2-2', lat: 36.5546, lng: 139.8911 },
  { name: '大谷資料館', address: '栃木県宇都宮市大谷町909', lat: 36.5950, lng: 139.8233 },
  { name: '宇都宮動物園', address: '栃木県宇都宮市上金井町552', lat: 36.6203, lng: 139.7944 },
  { name: 'カトリック松が峰教会', address: '栃木県宇都宮市松が峰1-1-5', lat: 36.5532, lng: 139.8836 },
  { name: '二荒山神社', address: '栃木県宇都宮市馬場通り1-1-1', lat: 36.5562, lng: 139.8924 },
  { name: 'ベルモールショッピングセンター', address: '栃木県宇都宮市操町6-7', lat: 36.5298, lng: 139.8716 },
];

async function main() {
  console.log('宇都宮市ランドマーク登録を開始します...');
  for (const loc of LANDMARKS) {
    await prisma.location.upsert({
      where: { id: `landmark-${loc.name}` },
      update: {},
      create: {
        id: `landmark-${loc.name}`,
        name: loc.name,
        address: loc.address,
        formattedAddress: loc.address,
        phone: null,
        lat: loc.lat,
        lng: loc.lng,
        city: '宇都宮市',
      },
    });
    console.log(`登録: ${loc.name}`);
  }
  console.log('完了しました');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
