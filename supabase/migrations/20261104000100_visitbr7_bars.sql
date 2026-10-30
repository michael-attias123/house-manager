-- "לאן יוצאים": the bars and night-life places on the city's tourism site,
-- visitbr7.co.il/night_life (Be'er Sheva municipality). A one-time import:
-- the site turns some networks away, so its list (22 posts, one of them a bar
-- tour, which is left out) was read once from GitHub Actions and turned into
-- the rows below by scripts/visitbr7-to-sql.py, which also explains how names,
-- links and hours are converted. To refresh it, run the script on a new
-- export into a new migration. The site lists no deals, so none are added.
--
-- Locations are Nominatim geocodes of the site's address: the place itself
-- for a few, often only its street (or a stop near it), and none when nothing
-- was found (lat/lng null: the app shows "מיקום לא ידוע").
--
-- A place already in the catalog (any source, same normalized name, within
-- 1500 m of the geocode, or anywhere in the city when there is none) only
-- gets the details it lacks; the weekly OSM load keeps them until OSM has
-- its own. The others are added with source 'visitbr7', which the OSM load
-- leaves alone. Should OSM add one of them later, the list shows it twice
-- until an admin hides one. Safe to run again: a place this import added
-- matches itself, even after an admin hid it.

alter table public.venues
  drop constraint venues_source_check,
  add constraint venues_source_check check (source in ('osm', 'community', 'hever', 'visitbr7'));

create temporary table visitbr7 (
  name text not null,
  kind text not null,
  lat double precision,
  lng double precision,
  address text,
  phone text,
  website text,
  instagram text,
  opening_hours text,
  cuisine text,
  venue_id bigint
);

insert into visitbr7 (name, kind, lat, lng, address, phone, website, instagram, opening_hours, cuisine) values
  ('מנצ''ילה', 'bar', null, null, 'קק"ל 101', '052-5667937', null, null, null, 'כשר'),
  ('בומבינו בר', 'bar', null, null, 'קקל 59', '0525398499', null, 'bombino_bar_coffee', 'Mo-Su 10:00-02:00', 'כשר'),
  ('מילבה', 'bar', 31.259958, 34.796574, 'שלמה המלך 2', '0503344618', null, 'mileva.br7', null, null),
  ('מצדה 31', 'bar', 31.257997, 34.795884, 'דרך מצדה 31', '0526250099', null, 'masada__31', null, null),
  ('נוקה לאונג בר', 'bar', 31.224024, 34.803937, 'ישפרו פלנט', '0779800411', null, 'nocca_lounge_bar', null, 'כשר'),
  ('פרינדס בר', 'bar', null, null, 'מצדה 17', '052-5907066', null, 'wefriendsbar', null, null),
  ('טרנטולה פאב', 'pub', 31.237555, 34.792336, 'קק"ל 175', '054-932-5943', 'https://www.facebook.com/profile.php?id=61559161834469', null, 'Mo-Su "מהשעה 20:00"', null),
  ('מועדון הפורום', 'nightclub', 31.221239, 34.80296, 'ניסים אלקיים 10', '0523202253', null, 'forumil', null, null),
  ('רינגבלום 13', 'bar', null, null, 'רינגבלום 13', '0537292317', null, 'ringelblum.13', null, null),
  ('עשן הזמן', 'bar', null, null, 'אנילביץ 17', '077-7644218', 'https://www.facebook.com/ashanhazman', 'ashanhazman', null, null),
  ('פרלה', 'bar', null, null, 'הסתדרות 39', null, 'https://www.facebook.com/pearla.beer7', null, 'Su-Th 17:00-02:00; Fr 21:30-02:00; Sa 19:00-02:00 "במוצאי שבת"', null),
  ('הדוקטור בר', 'bar', null, null, 'דרך מצדה 6 מרכז הנגב', '0543479772', null, 'the_doctor_b7', null, null),
  ('חייאתי', 'bar', 31.255423, 34.795307, 'ביאליק 5', null, null, 'hayaati_tapas_bar', null, null),
  ('גלריית סול', 'bar', 31.243514, 34.793456, 'החלוץ 39', '0507180081', 'https://www.facebook.com/solstudioart2021', null, null, null),
  ('בית בירה', 'pub', 31.238876, 34.78922, 'החלוץ 29', '054-559-1401', 'https://www.facebook.com/b7beerhouse', null, null, null),
  ('החלוץ 33', 'nightclub', 31.238056, 34.788199, 'החלוץ 33', '0525114591', 'https://www.halutz.co.il/', null, null, null),
  ('בר גיורא', 'bar', 31.26089, 34.79298, null, '0526469647', 'https://www.facebook.com/BAR.GIORA.B7', null, null, 'כשר'),
  ('ויקטוריה בר', 'bar', 31.246703, 34.810904, 'יצחק נפחא 25', '0507555371', 'https://victoria-br7.co.il/', 'victoria.br7', null, null),
  ('ששון בר', 'pub', 31.237555, 34.792336, 'קק"ל 195', '0512506909', null, 'sassonbar', null, null),
  ('זאלמה קוקטייל בר', 'bar', 31.242728, 34.803684, 'הנגרים 4', '0546935522', 'https://www.zalame.co.il/', null, null, null),
  ('טינטו', 'bar', 31.258914, 34.7972, 'ראובן רובין 5', '0779386133', null, 'tinto_deli_tapas', null, null)
;

-- The catalog's own entry for it, if any: a visible approved place with the
-- same name, the nearest within 1500 m, or, without a location, any in the
-- city (web/src/features/going-out/lib/geo.ts BEER_SHEVA.bbox). A place this
-- import added counts even when hidden, so running it again adds no twin.
update visitbr7 t set venue_id = (
  select v.id
  from public.venues v
  where v.status = 'approved' and (not v.hidden or v.source = 'visitbr7')
    and public.norm_name(v.name) = public.norm_name(t.name)
    and case
      when t.lat is null then v.lat is null or (v.lat between 31.2 and 31.3 and v.lng between 34.73 and 34.86)
      else v.lat is not null
        and sqrt(power((v.lat - t.lat) * 111195, 2) + power((v.lng - t.lng) * 111195 * cos(radians(t.lat)), 2)) < 1500
    end
  order by v.hidden, v.source = 'visitbr7' desc,
    coalesce(power(v.lat - t.lat, 2) + power(v.lng - t.lng, 2), 0), v.id
  limit 1
);

update public.venues v set
  phone = coalesce(v.phone, t.phone),
  website = coalesce(v.website, t.website),
  instagram = coalesce(v.instagram, t.instagram),
  address = coalesce(v.address, t.address),
  opening_hours = coalesce(v.opening_hours, t.opening_hours),
  cuisine = coalesce(v.cuisine, t.cuisine)
from visitbr7 t
where t.venue_id = v.id
  and (v.phone, v.website, v.instagram, v.address, v.opening_hours, v.cuisine) is distinct from
      (coalesce(v.phone, t.phone), coalesce(v.website, t.website), coalesce(v.instagram, t.instagram),
       coalesce(v.address, t.address), coalesce(v.opening_hours, t.opening_hours), coalesce(v.cuisine, t.cuisine));

insert into public.venues
  (name, kind, lat, lng, address, phone, website, instagram, opening_hours, cuisine, source, status, household_id, created_by)
select name, kind, lat, lng, address, phone, website, instagram, opening_hours, cuisine, 'visitbr7', 'approved', null, null
from visitbr7
where venue_id is null;

drop table visitbr7;
