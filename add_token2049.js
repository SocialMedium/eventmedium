var {Pool}=require('pg');
var p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
async function go(){
  await p.query("UPDATE events SET event_date='2026-10-07', expected_attendees=15000, description='TOKEN2049 Singapore - the worlds largest crypto event. Venue: Marina Bay Sands.', source_url='https://www.token2049.com/singapore' WHERE id=16");
  console.log('Updated TOKEN2049 Singapore');
  await p.query("INSERT INTO events (name,description,event_date,city,country,event_type,themes,slug,source_url,expected_attendees) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)",
    ['TOKEN2049 Dubai','TOKEN2049 Dubai - the worlds largest crypto event. 15,000+ attendees, 200+ exhibitors. Venue: Madinat Jumeirah.','2026-04-29','Dubai','UAE','conference',JSON.stringify(['FinTech','AI','Enterprise SaaS','Regulation']),'token2049-dubai','https://www.token2049.com/dubai',15000]);
  console.log('Added TOKEN2049 Dubai');
  p.end();
}
go().catch(e=>{console.error(e);p.end()});
