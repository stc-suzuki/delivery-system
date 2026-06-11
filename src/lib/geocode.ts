export async function geocodeAddress(address: string) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}&language=ja&region=JP`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') throw new Error(`ジオコーディング失敗: ${data.status}`);
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng, formattedAddress: data.results[0].formatted_address as string };
}
