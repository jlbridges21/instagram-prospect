alter table public.prospects
  add column if not exists discovery_pre_score integer;

alter table public.discovery_sessions
  add column if not exists candidates_collected integer not null default 0,
  add column if not exists candidates_deferred integer not null default 0;

alter table public.settings
  add column if not exists discovery_min_pre_score integer not null default 35;

alter table public.settings drop constraint if exists settings_min_pre_score_check;
alter table public.settings
  add constraint settings_min_pre_score_check check (discovery_min_pre_score between 0 and 100);

update public.settings
set discovery_negative_keywords = array[
  'meme','fanpage','fan page','fitness','athlete','gaming','crypto','celebrity','musician','music artist',
  'lifestyle','travel influencer','nasa','restaurant','health','fashion','sports','freestyle','racing','hobby',
  'race team','fpv freestyle','rc pilot','ai news','ads'
]
where id = 1
  and discovery_negative_keywords = '{}';

update public.settings
set discovery_positive_keywords = array[
  'drone','aerial','photography','photographer','real estate','realestate','media','video','videography','videographer',
  'fpv','uav','aerial media','property media','real estate media','content creator','production','photo','photos',
  'commercial','creative','property','cinematography','films','visuals','productions','fpv filming'
]
where id = 1
  and discovery_positive_keywords = array[
    'drone','aerial','photography','photographer','real estate','realestate','media','video','videography','videographer',
    'fpv','uav','aerial media','property media','real estate media','content creator','production'
  ];
