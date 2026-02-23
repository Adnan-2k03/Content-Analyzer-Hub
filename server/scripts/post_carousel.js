(async () => {
  try {
    const payload = { images: ['aGVsbG8=', 'd29ybGQ='], url: null };
    const res = await fetch('http://127.0.0.1:5000/api/content/carousel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log('Status:', res.status);
    console.log('Response:', text);
  } catch (err) {
    console.error('Request failed:', err);
    process.exit(1);
  }
})();
