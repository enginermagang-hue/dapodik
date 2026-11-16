/* =========================================================================
   scrape-lulusan.js  —  lulusan 2022-2026 per sekolah (SMA/SMK/SLB NTT)

   Target : https://datadik.kemendikdasmen.go.id/manage   (login Operator Dinas)
   Pakai  : F12 -> Console -> paste seluruh file ini -> Enter

   PENTING — WAF Dapodik:
   Server membalas HTTP 468 bila menerima request paralel/serempet.
   Karena itu CONCURRENCY default = 1 (sekuensial).
   Pacing adaptif otomatis: mulai DELAY 150ms, turun 25ms tiap 40 sekolah
   lancar sampai MIN_DELAY (120ms). Bila diblokir: cooldown 60s + delay naik
   250ms, maksimal MAX_RECOVER kali sebelum menyerah.

   Sebelum menjalankan penuh, ukur dulu batas aman:
       CFG.MODE = 'probe'   -> uji jumlah request paralel yang diizinkan
       CFG.MODE = 'probe2'  -> cari endpoint ekspor yang lebih hemat request

   UJI DATA: CFG.LIMIT = 5, cocokkan dengan UI, baru set LIMIT = 0.

   Perintah bantu di console:
     __dapo.probe()      -> ukur batas WAF + uji batch kabupaten
     __dapo.probe2()     -> telusuri jalur ekspor (ngeksel dll.)
     __dapo.sidExport()  -> unduh peta NPSN -> sid (map_sid_N.json)
     __dapo.sidImport()  -> pulihkan peta sid: sidImport(<isi file JSON>)
     __dapo.stats()      -> req/s, persen, ETA, delay, blokir
     __dapo.progress()   -> ringkasan progres
     __dapo.eta()        -> estimasi sisa waktu
     __dapo.delay(250)   -> paksa jeda tertentu
     __dapo.stop()       -> berhenti rapi (progres tersimpan)
     __dapo.reset()      -> hapus checkpoint, mulai dari nol

   Catatan:
   - Tab HARUS aktif di depan (Chrome men-throttle timer di tab background).
   - File CSV masuk ke folder Downloads. Saat file ke-2 dan seterusnya,
     Chrome menampilkan "This site is attempting to download multiple files"
     -> klik Allow.
   ========================================================================= */
(() => {
  'use strict';

  const CFG = {
    TAHUN: ['2022', '2023', '2024', '2025', '2026'],

    MODE: 'run',         // 'run' | 'probe' (batas WAF) | 'probe2' (jalur ekspor)

    // --- kecepatan -------------------------------------------------------
    // Server Dapodik memblokir request paralel (HTTP 468). Mulai dari 1.
    CONCURRENCY: 1,      // 1 = sekuensial (aman). Jangan >1 tanpa hasil probe hijau.
    DELAY: 150,          // jeda awal antar request (ms) - turun otomatis bila lancar
    MIN_DELAY: 120,      // batas tercepat pacing adaptif
    MAX_DELAY: 1200,     // batas terlambat setelah kena blokir
    JITTER: 80,          // keacakan tambahan (ms)
    SPEED_STEP: 25,      // penurunan delay tiap SPEED_EVERY sekolah sukses
    SPEED_EVERY: 40,
    RETRY: 2,            // percobaan ulang untuk error non-WAF
    COOLDOWN: 60000,     // jeda setelah diblokir (ms)
    MAX_RECOVER: 3,      // berapa kali boleh pulih dari blokir sebelum menyerah
    BLOCK_CODES: [403, 429, 468, 503], // status yang dianggap blokir WAF

    // --- perilaku --------------------------------------------------------
    LIMIT: 0,            // 0 = semua 1.052 sekolah
    MODE_DATA: 'lengkap',// 'lengkap' = simpan data murid | 'rekap' = hanya jumlah per sekolah
    STORE_STUDENTS: true,// kompatibilitas lama; otomatis false bila MODE_DATA='rekap'
    REKAP_KABUPATEN: true, // ikut membuat rekap_kabupaten_ntt.csv
    BATCH_KABUPATEN: false, // false = cari sid per NPSN (akurat; batch kabupaten hanya cocok 97/1052)
    ROWS_PER_CSV: 60000, // pecah CSV tiap N baris (makin besar = makin sedikit file)
    SAVE_EVERY: 25,      // simpan checkpoint tiap N sekolah selesai
    SEP_LINE: true,      // baris "sep=," agar Excel lokal ID memisah kolom dengan benar
    KEY: 'dapo_lulusan_v4'
  };

  /* ---- 1.052 NPSN dari daftar sekolah.json ---- */
  const NPSN_RAW = `
50301935 70055686 74986808 50300269 75096361 70007712 50301009 74591526 70055317 70056259 50309624
69733991 50301883 69856893 50306157 50304069 50309191 50307297 70055316 70059143 73395648 70060035
70004318 70046451 69965787 69928409 50302299 50310680 69727076 50307309 50309041 69847634 50307418
69886262 70010483 70040310 70011829 70035286 50303346 50304080 69830517 70056493 70012537 70060320
69896981 69727541 50301894 50308344 60728867 69888491 70061193 50300590 69990571 69768276 70055563
50306213 69947414 50307420 74472959 50306155 70011429 50309205 50307310 70012355 50306153 70031328
70014783 69894993 50302966 69903631 50308525 69969645 50304969 70012982 50302298 50303441 70011567
50305124 69769430 70011617 70043380 50308048 60702909 70011653 50302144 50304950 50304121 50305790
70011697 70048132 69862420 50301154 50309365 50305542 70036020 69946742 50305066 69991325 70036755
50306164 70032115 69988048 69947565 70027341 70007125 50306447 69939441 70036751 50303397 50301377
70011565 70011695 70011696 50309571 70050820 70014823 70015996 50307944 50305291 50303911 50305343
69774954 50300449 69853544 69864704 69899913 69906816 50302627 50305713 50302308 70005569 50305403
69969313 74932548 69888653 50307412 70031438 50302625 70039945 50305405 50302624 69756578 50303811
50302950 50302623 69981153 50304948 70038404 70038367 70010100 78852977 69968986 70025364 69974232
50305398 50301673 69727247 70043568 50305401 50305402 50304936 69898964 69989458 70045604 69973672
69896535 70039970 69969008 69934104 69976812 69883571 50303810 69969250 50304603 70009636 69896554
50304070 70006753 50302622 50303809 69856246 69856247 69946205 69899844 69901175 50301882 69900148
50301884 50301676 50309597 50300270 50306570 50300244 69822786 60728884 50300271 69849615 69950302
69906703 50302621 50305767 69967658 70003936 69899648 69947784 70013476 69933619 50300272 70050806
69950296 50303792 70037183 50302619 69763276 70051099 69774697 69774695 50310802 69899649 50305768
70010895 70014575 69899650 50303779 50300268 60728878 69888754 50306572 70054385 50308342 69753895
50303774 69888501 50301415 70039972 50302618 69913893 69902674 69774696 69945318 69892401 70053756
69972832 50309612 69772544 50309317 69972984 50302597 69774698 70030869 70004745 69968987 70045339
70013372 70005948 69989225 69842625 69981214 70013217 70038444 70048523 69932980 70030897 69756681
70028651 69939898 50300020 69832839 69948439 70007752 50303773 70013187 69989831 70005736 69938580
69888778 69761909 70002114 69946284 69954539 69849076 69842626 60728881 69971705 69968997 69947480
69726042 69920505 69842627 70011353 69944240 69762586 69902385 69774846 69864708 69728424 69843060
50305397 70010974 70006453 70014745 69919910 50309319 70010961 69888990 69993057 69975241 69990872
70031959 69946086 69878677 70006452 69948506 69988075 69902442 69981389 69900214 69864623 69864615
69946432 69962131 70013307 50302620 69772588 70041385 69989137 70013634 69896247 69847627 69981042
69894295 70006491 69799865 70032352 69877329 70011428 50308603 69734401 69979856 70041021 70011899
70032235 70033862 70026924 70053816 70033583 70006451 69987799 70016034 70012744 70013321 69897125
69948621 70038167 69939617 69903967 70036796 69904815 69971102 69889079 69899565 69839276 70011407
69981634 69939495 69883508 50303793 69947798 69870904 69969786 69895838 69895841 69897141 70009620
69895839 69822783 70039488 70003150 70027436 69870671 69987476 69988292 50301403 69987823 50300260
70036039 70047453 69978320 69979990 69978354 50300261 50306151 70011652 50301896 50301878 69966104
70036877 69947662 50301887 69978370 70047415 50301885 70010693 50301879 69947958 70015903 69846046
50309323 69986032 50305399 50309006 69895842 69895840 69896150 50305305 50307410 50309015 50302954
50300583 50307291 50300584 69734023 69822785 50309598 50301404 50302956 50302315 50308365 50308593
50303425 50308594 50306571 50309599 69725918 50306183 69946949 69946999 69947000 50301007 50301695
69822791 50301006 50309259 50304067 50304771 50308595 50304931 50300273 50300274 50308981 50308596
60726234 50303429 69734147 69733944 50308982 69733989 50304604 50304068 50304770 50309603 50309321
69774869 50302306 50302955 50304775 50300585 50304406 50308364 50302305 50304405 50304605 50305901
50308597 69734148 50307941 50307844 50304610 50304606 50304607 50304608 50304609 50307942 50300275
69733990 50300276 50308598 50308361 50303447 50306188 50307294 50301898 69822787 50300267 50307416
50302304 60726236 50306149 50309318 50309324 60726630 50308363 50309608 50304081 50309611 50308302
50306170 60702920 69822788 69765062 69758125 69772619 69947184 50308599 69760873 50308601 50309614
69765060 69772616 50305902 50301005 50308980 50308602 50304930 60728880 69768296 50300259 69775289
50310686 50303316 50310801 50302295 50305137 69760874 50308604 50308362 69726058 69774728 69972601
50309258 50308605 50309616 50309284 50305119 69768157 50309283 50309282 69726059 50309280 69768161
50310687 50305120 69768158 50310691 69725270 70006140 50309281 69768162 50310688 50304947 69768159
50310684 69888802 50310689 50304946 69768160 50310685 69888773 50310690 50304945 69888717 69768163
69888662 50305121 69888718 69768164 50304943 69862588 69762588 69762590 69759213 50300586 50305903
50309196 50307413 69728422 50309322 69882386 69862587 69759214 50309579 69728423 69728420 69889073
50300587 69985439 50307298 50307299 69822782 69762587 50300984 69771356 69727470 50307411 69762589
69759212 69727469 50301003 50309194 50307414 50309195 69987673 50301004 50309622 50307415 69762591
69889074 69774849 50305307 50305376 50307301 50305898 69862586 50305406 69762592 50301400 50309473
50300243 50300664 50304949 50302309 50301401 50303442 50309383 50303443 50303445 69760655 50307282
50305261 69822789 50309581 50308513 50309120 50300257 50310786 50308592 50308607 50309224 50304066
50303446 50300665 50304065 50302314 69968724 50302951 50301881 50302312 69734157 50304937 50302311
50302957 50301674 50305262 50307284 50301675 69767796 50300683 50307286 50309375 50309198 69726555
50305347 50307287 50307288 50305118 50307289 50300258 50300256 50304061 50304062 70008273 50304063
50301402 50308366 50305899 50304935 50305306 50306082 69725921 50301008 50301886 50304934 50302310
50307302 50309192 50300582 50304407 50300262 69763284 50306573 50302958 50304773 50309377 50310683
50308606 50301877 50304064 50304933 50303422 50302968 50309590 50302952 50303418 50304772 50303423
50302953 50307939 50309591 50304774 50303419 50307940 69774563 50302313 50303424 50309626 50309374
50307304 50305384 69830518 50309594 50305263 69752273 50308460 50303421 50300263 70053961 69947212
69978535 70029990 69978864 69915186 70035167 69847638 70048447 77644736 70049459 69786550 70033545
69774565 NP259283 70005384 69935090 69895846 69895857 70040080 70035131 70047266 70041648 69900123
69831984 70041430 69895845 69990340 69881354 50305714 50309316 69903531 69900741 50305396 70051023
69934107 69900259 69981848 70047816 69905530 69972270 69949821 69972272 69895834 69895844 70050789
69900564 69895852 70052241 70057428 70052999 69980330 69985253 69856248 69888596 69896139 69939165
70012936 70043706 70012907 50305392 50301011 69881355 69842629 69842630 70052279 69954192 70047212
70035675 70010024 70024103 69774699 70032123 70044135 69957059 70039100 50308343 50303772 70024101
70010042 70045155 50302628 69954174 69966368 69857892 69867911 50303771 70011318 70035268 50305393
70005734 69864616 69933884 50308523 50308975 50305766 69774700 69903685 70035133 70043298 70038323
70029086 70012332 70050017 70039863 70033793 69872150 50306154 69900339 69888528 50309364 70010881
70006493 69899750 69889030 69941983 70006278 50309398 70029855 70035801 69895847 69831999 69895850
70040948 69895858 69980182 50302629 70040051 69896077 69734022 69896151 50303344 69759088 69969545
69990902 70029736 69895849 69896152 69901257 69990276 70001991 70039968 69842631 69899025 69900205
50306156 50301893 69962868 50308482 70001784 70041269 70012225 69979220 71012297 50301891 79980430
70045766 69962869 70032284 72583858 50301892 70025653 50308483 70039944 50305395 69895851 70006045
78655605 69892779 69872386 70005057 70039971 50304942 69900565 69899118 50305394 50302967 69727854
50306182 69763279 69752276 69725916 69728761 69765059 50309313 50308608 50305138 69768166 50305139
50300265 50305905 69727866 69757517 69759089 69726021 50304998 50308202 50304778 50306165 50308609
60726239 50304390 50304612 50304071 69774953 50304613 50300264 69768165 50307306 69815324 50307943
50304079 60726238 50308201 69759090 50309372 69774562 69775283 69888710 50304997 69827625 69888796
50306093 69727077 50308996 50304991 50305770 50305904 50304992 50305769 50305267 50304940 60702921
60702922 69864625 69754734 69757332 69894300 50307308 69756418 69757276 69772591 50309394 50301671
69758212 69725863 69758177 69768282 50309199 69933644 69867944 50305348 50301010 50306189 50309391
50302300 50307311 50309397 69883260 50309204 50303342 69775286 50302297 50305264 50307419 50308936
50306575 50308524 50304392 50309261 50304994 50303343 69765815 50301013 50301399 50308303 50307417
69768281 50304391 50306574 50305265 50309412 69757516 50305266 50304995 50309163 50309053 50309049
50300588 50310692 50304611 50304996 50309206 50304941 50304993 50302959 50309203 60728905 69786214
50304377 50305908 50305308 50302301 50302302 50301398 69733979 50309417 50304779 50302303 69774730
50308481 50306576 50303347 50304970 69725865 50302316 50302270
`;

  /* ---------------------------------------------------------------- */
  const NPSN = NPSN_RAW.trim().split(/\s+/).filter(Boolean);

  /* ---- peta wilayah: NPSN|kabupaten|kecamatan (dari daftar sekolah.json) ---- */
  const WILAYAH_RAW = `
50301935|Kab. Flores Timur|Larantuka
70055686|Kab. Manggarai Barat|Lembor
74986808|Kab. Sumba Barat Daya|Kodi Utara
50300269|Kab. Kupang|Amarasi
75096361|Kab. Sumba Barat Daya|Kodi Utara
70007712|Kab. Kupang|Kupang Tengah
50301009|Kab. Timor Tengah Utara|Kota Kefamenanu
74591526|Kab. Kupang|Kupang Tengah
70055317|Kab. Belu|Tasifeto Timur
70056259|Kota Kupang|Oebobo
50309624|Kab. Kupang|Amabi Oefeto Timur
69733991|Kab. Sabu Raijua|Hawu Mehara
50301883|Kab. Flores Timur|Larantuka
69856893|Kab. Sabu Raijua|Raijua
50306157|Kab. Flores Timur|Titehena
50304069|Kab. Sumba Barat|Kota Waikabubak
50309191|Kab. Timor Tengah Selatan|Kolbano
50307297|Kab. Timor Tengah Selatan|Kie
70055316|Kab. Sumba Barat Daya|Kodi Utara
70059143|Kab. Kupang|Taebenu
73395648|Kab. Belu|Lamakmen
70060035|Kab. Timor Tengah Selatan|Kota Soe
70004318|Kab. Flores Timur|Larantuka
70046451|Kab. Timor Tengah Utara|Kota Kefamenanu
69965787|Kab. Flores Timur|Demon Pagong
69928409|Kab. Sumba Barat Daya|Kodi Utara
50302299|Kab. Sikka|Alok
50310680|Kab. Manggarai Timur|Lamba Leda Selatan (Poco Ranaka)
69727076|Kab. Sumba Barat Daya|Wewewa Barat
50307309|Kab. Timor Tengah Selatan|Kolbano
50309041|Kab. Timor Tengah Selatan|Kualin
69847634|Kab. Timor Tengah Selatan|Kualin
50307418|Kab. Timor Tengah Utara|Musi
69886262|Kab. Flores Timur|Witihama
70010483|Kab. Ende|Ndori
70040310|Kab. Ende|Ende Timur
70011829|Kab. Manggarai Barat|Komodo
70035286|Kab. Timor Tengah Utara|Insana Barat
50303346|Kab. Manggarai|Langke Rembong
50304080|Kab. Sumba Barat Daya|Kota Tambolaka
69830517|Kab. Sumba Barat Daya|Kota Tambolaka
70056493|Kab. Timor Tengah Selatan|Amanuban Barat
70012537|Kab. Ende|Ende Timur
70060320|Kab. Manggarai|Cibal
69896981|Kab. Sumba Barat Daya|Kota Tambolaka
69727541|Kab. Kupang|Kupang Barat
50301894|Kab. Flores Timur|Ile Mandiri
50308344|Kab. Sumba Tengah|Mamboro
60728867|Kab. Kupang|Takari
69888491|Kab. Sumba Barat|Loli
70061193|Kab. Manggarai|Satarmese
50300590|Kab. Timor Tengah Selatan|Kota Soe
69990571|Kab. Belu|Atambua Barat
69768276|Kab. Ende|Detukeli
70055563|Kab. Sumba Timur|Mahu
50306213|Kab. Ngada|Bajawa Utara
69947414|Kab. Timor Tengah Selatan|BatuPutih
50307420|Kab. Timor Tengah Utara|Miomafo Barat
74472959|Kab. Sikka|Doreng
50306155|Kab. Flores Timur|Wulang Gitang
70011429|Kab. Timor Tengah Selatan|Mollo Tengah
50309205|Kab. Timor Tengah Selatan|Amanuban Timur
50307310|Kab. Timor Tengah Selatan|Polen
70012355|Kab. Timor Tengah Selatan|Santian
50306153|Kab. Flores Timur|Solor Timur
70031328|Kab. Timor Tengah Selatan|Amanatun Selatan
70014783|Kab. Timor Tengah Selatan|Mollo Utara
69894993|Kab. Kupang|Kupang Tengah
50302966|Kab. Ngada|Bajawa
69903631|Kab. Ende|Ndona
50308525|Kab. Manggarai|Langke Rembong
69969645|Kab. Nagekeo|Aesesa
50304969|Kota Kupang|Kota Raja
70012982|Kab. Kupang|Amfoang Selatan
50302298|Kab. Sikka|Alok
50303441|Kab. Manggarai|Langke Rembong
70011567|Kab. Flores Timur|Ile Mandiri
50305124|Kota Kupang|Kelapa Lima
69769430|Kab. Belu|Atambua Barat
70011617|Kab. Kupang|Taebenu
70043380|Kab. Sikka|Paga
50308048|Kab. Sumba Barat|Loli
60702909|Kab. Sikka|Alok
70011653|Kab. Sikka|Alok Timur
50302144|Kab. Sikka|Alok Timur
50304950|Kota Kupang|Kelapa Lima
50304121|Kab. Sumba Barat|Loli
50305790|Kab. Alor|Alor Tengah Utara
70011697|Kab. Kupang|Amarasi Barat
70048132|Kota Kupang|Maulafa
69862420|Kab. Ngada|Bajawa
50301154|Kab. Timor Tengah Utara|Kota Kefamenanu
50309365|Kab. Manggarai Timur|Borong
50305542|Kab. Ende|Ende Selatan
70036020|Kab. Ngada|Soa
69946742|Kab. Manggarai Barat|Komodo
50305066|Kota Kupang|Kelapa Lima
69991325|Kota Kupang|Kota Raja
70036755|Kab. Rote Ndao|Rote Timur
50306164|Kab. Lembata|Nubatukan
70032115|Kab. Malaka|Weliman
69988048|Kab. Sumba Barat Daya|Loura
69947565|Kab. Timor Tengah Selatan|Amanuban Tengah
70027341|Kab. Timor Tengah Utara|Bikomi Selatan
70007125|Kab. Kupang|Semau
50306447|Kab. Kupang|Fatuleu
69939441|Kab. Alor|Pantar Tengah
70036751|Kab. Sabu Raijua|Sabu Tengah
50303397|Kab. Manggarai|Langke Rembong
50301377|Kab. Belu|Kota Atambua
70011565|Kab. Alor|Alor Tengah Utara
70011695|Kab. Ende|Ende Tengah
70011696|Kab. Lembata|Nubatukan
50309571|Kab. Sumba Tengah|Katiku Tana Selatan
70050820|Kab. Lembata|Naga Wutung
70014823|Kab. Manggarai|Ruteng
70015996|Kab. Manggarai Timur|Rana Mese
50307944|Kab. Manggarai|Langke Rembong
50305291|Kab. Sikka|Alok
50303911|Kab. Sumba Timur|Kanatang
50305343|Kab. Rote Ndao|Lobalain
69774954|Kab. Nagekeo|Aesesa
50300449|Kab. Timor Tengah Selatan|Kota Soe
69853544|Kab. Nagekeo|Aesesa
69864704|Kab. Lembata|Nubatukan
69899913|Kab. Malaka|Wewiku
69906816|Kab. Malaka|Wewiku
50302627|Kab. Ende|Ende Tengah
50305713|Kab. Ende|Ende Timur
50302308|Kab. Sikka|Paga
70005569|Kab. Ngada|Golewa
50305403|Kab. Ende|Maurole
69969313|Kota Kupang|Oebobo
74932548|Kab. Sumba Barat|Tana Righu
69888653|Kab. Malaka|Kobalima
50307412|Kab. Timor Tengah Utara|Kota Kefamenanu
70031438|Kab. Sumba Barat Daya|Wewewa Selatan
50302625|Kab. Ende|Ende Selatan
70039945|Kab. Sumba Barat|Tana Righu
50305405|Kab. Ende|Lio Timur
50302624|Kab. Ende|Nangapanda
69756578|Kab. Manggarai Barat|Kuwus Barat
50303811|Kab. Sumba Timur|Kota Waingapu
50302950|Kab. Nagekeo|Aesesa
50302623|Kab. Ende|Ende Utara
69981153|Kab. Malaka|Wewiku
50304948|Kota Kupang|Kota Lama
70038404|Kab. Sumba Barat Daya|Wewewa Barat
70038367|Kab. Sumba Barat Daya|Kodi Bangedo
70010100|Kab. Sumba Barat|Tana Righu
78852977|Kab. Sumba Barat|Lamboya
69968986|Kab. Sumba Barat Daya|Wewewa Barat
70025364|Kab. Sumba Barat Daya|Loura
69974232|Kab. Sumba Barat Daya|Kodi Utara
50305398|Kab. Ende|Ende Timur
50301673|Kab. Alor|Teluk Mutiara
69727247|Kab. Nagekeo|Aesesa
70043568|Kab. Timor Tengah Utara|Biboki Anleu
50305401|Kab. Ende|Ende Tengah
50305402|Kab. Ende|Ende Tengah
50304936|Kota Kupang|Oebobo
69898964|Kab. Alor|Alor Tengah Utara
69989458|Kab. Sumba Barat Daya|Wewewa Tengah
70045604|Kab. Sumba Barat Daya|Wewewa Utara
69973672|Kab. Rote Ndao|Ndao Nuse
69896535|Kota Kupang|Oebobo
70039970|Kab. Sumba Barat Daya|Wewewa Selatan
69969008|Kab. Rote Ndao|Lobalain
69934104|Kab. Timor Tengah Selatan|Mollo Selatan
69976812|Kab. Malaka|Malaka Barat
69883571|Kab. Kupang|Kupang Tengah
50303810|Kab. Sumba Timur|Kambera
69969250|Kab. Timor Tengah Utara|Kota Kefamenanu
50304603|Kab. Rote Ndao|Lobalain
70009636|Kab. Rote Ndao|Lobalain
69896554|Kota Kupang|Maulafa
50304070|Kab. Sumba Tengah|Katiku Tana
70006753|Kab. Manggarai Barat|Komodo
50302622|Kab. Ende|Ende Utara
50303809|Kab. Sumba Timur|Kota Waingapu
69856246|Kab. Lembata|Omesuri
69856247|Kab. Lembata|Ile Ape
69946205|Kab. Alor|Kabola
69899844|Kab. Flores Timur|Lewolema
69901175|Kab. Flores Timur|Adonara
50301882|Kab. Flores Timur|Adonara Barat
69900148|Kab. Flores Timur|Adonara Tengah
50301884|Kab. Flores Timur|Adonara Timur
50301676|Kab. Alor|Alor Barat Daya
50309597|Kab. Kupang|Amabi Oefeto
50300270|Kab. Kupang|Amarasi Barat
50306570|Kab. Kupang|Amarasi Selatan
50300244|Kab. Kupang|Amarasi Timur
69822786|Kab. Kupang|Amfoang Tengah
60728884|Kab. Kupang|Amfoang Timur
50300271|Kab. Kupang|Amfoang Utara
69849615|Kab. Nagekeo|Boawae
69950302|Kab. Lembata|Buyasuri
69906703|Kab. Flores Timur|Demon Pagong
50302621|Kab. Ende|Ende Tengah
50305767|Kab. Sumba Timur|Kanatang
69967658|Kab. Lembata|Ile Ape Timur
70003936|Kab. Ngada|Jerebuu
69899648|Kab. Sumba Timur|Kahaungu Eti
69947784|Kab. Sumba Barat Daya|Kodi Bangedo
70013476|Kab. Sumba Barat Daya|Kodi Utara
69933619|Kab. Sumba Barat Daya|Kota Tambolaka
50300272|Kab. Kupang|Kupang Barat
70050806|Kab. Sumba Barat|Lamboya
69950296|Kab. Lembata|Lebatukan
50303792|Kab. Sumba Timur|Lewa
70037183|Kab. Sumba Barat|Loli
50302619|Kab. Ende|Nangapanda
69763276|Kab. Kupang|Nekamese
70051099|Kab. Sumba Timur|Ngadu Ngala
69774697|Kab. Sumba Timur|Nggaha Ori Angu
69774695|Kab. Sumba Timur|Paberiwai
50310802|Kab. Manggarai Barat|Pacar
69899649|Kab. Sumba Timur|Pahunga Lodu
50305768|Kab. Sumba Timur|Pandawai
70010895|Kab. Ngada|Riung
70014575|Kab. Sumba Tengah|Umbu Ratu Nggay
69899650|Kab. Sumba Timur|Rindi
50303779|Kab. Sumba Timur|Umalulu
50300268|Kab. Kupang|Semau
60728878|Kab. Kupang|Semau Selatan
69888754|Kab. Flores Timur|Solor Selatan
50306572|Kab. Kupang|Takari
70054385|Kab. Sumba Tengah|Umbu Ratu Nggay Tengah
50308342|Kab. Sumba Tengah|Katiku Tana Selatan
69753895|Kab. Sikka|Waigete
50303774|Kab. Sumba Timur|Kota Waingapu
69888501|Kab. Sumba Barat|Wanokaka
50301415|Kab. Belu|Lamakmen
70039972|Kab. Sumba Barat Daya|Wewewa Barat
50302618|Kab. Ende|Wolowaru
69913893|Kab. Lembata|Wulandoni
69902674|Kab. Flores Timur|Wulang Gitang
69774696|Kab. Sumba Timur|Wulla Waijelu
69945318|Kab. Manggarai Timur|Borong
69892401|Kota Kupang|Alak
70053756|Kota Kupang|Alak
69972832|Kab. Nagekeo|Aesesa
50309612|Kab. Kupang|Amarasi Barat
69772544|Kab. Kupang|Amfoang Timur
50309317|Kab. Belu|Tasifeto Barat
69972984|Kab. Nagekeo|Boawae
50302597|Kab. Ende|Ende Utara
69774698|Kab. Sumba Timur|Haharu
70030869|Kab. Sabu Raijua|Hawu Mehara
70004745|Kab. Ngada|Jerebuu
69968987|Kab. Nagekeo|Keo Tengah
70045339|Kab. Sumba Barat Daya|Kodi
70013372|Kab. Manggarai Barat|Lembor
70005948|Kab. Sabu Raijua|Sabu Liae
69989225|Kab. Rote Ndao|Lobalain
69842625|Kab. Manggarai Barat|Ndoso
69981214|Kab. Kupang|Nekamese
70013217|Kab. Manggarai Barat|Pacar
70038444|Kab. Ngada|Riung Barat
70048523|Kab. Rote Ndao|Rote Barat Daya
69932980|Kab. Manggarai|Ruteng
70030897|Kab. Sabu Raijua|Sabu Barat
69756681|Kab. Kupang|Semau
70028651|Kab. Ngada|Soa
69939898|Kab. Kupang|Sulamu
50300020|Kab. Kupang|Takari
69832839|Kab. Belu|Tasifeto Barat
69948439|Kab. Belu|Tasifeto Timur
70007752|Kab. Sumba Timur|Umalulu
50303773|Kab. Sumba Timur|Kota Waingapu
70013187|Kab. Manggarai Barat|Welak
69989831|Kab. Sumba Barat Daya|Wewewa Timur
70005736|Kab. Kupang|Amabi Oefeto Timur
69938580|Kab. Kupang|Amarasi Selatan
69888778|Kab. Kupang|Amarasi Timur
69761909|Kab. Belu|Kakuluk Mesak
70002114|Kab. Manggarai|Cibal
69946284|Kab. Kupang|Fatuleu Tengah
69954539|Kab. Alor|Teluk Mutiara
69849076|Kab. Timor Tengah Utara|Kota Kefamenanu
69842626|Kab. Manggarai Barat|Komodo
60728881|Kab. Kupang|Kupang Timur
69971705|Kab. Manggarai Barat|Macang Pacar
69968997|Kab. Manggarai Barat|Ndoso
69947480|Kab. Kupang|Takari
69726042|Kab. Sumba Timur|Kota Waingapu
69920505|Kab. Belu|Atambua Barat
69842627|Kab. Manggarai Barat|Komodo
70011353|Kab. Kupang|Takari
69944240|Kab. Manggarai Timur|Lamba Leda Utara
69762586|Kab. Alor|Lembur
69902385|Kab. Malaka|Wewiku
69774846|Kab. Alor|Alor Barat Laut
69864708|Kab. Malaka|Malaka Barat
69728424|Kab. Timor Tengah Utara|Bikomi Utara
69843060|Kab. Timor Tengah Utara|Bikomi Tengah
50305397|Kab. Ende|Detusoko
70010974|Kab. Alor|Alor Timur Laut
70006453|Kab. Timor Tengah Selatan|Fatukopa
70014745|Kab. Timor Tengah Selatan|Fautmolo
69919910|Kab. Malaka|Malaka Tengah
50309319|Kab. Malaka|Malaka Tengah
70010961|Kab. Ngada|Riung Selatan (Wolomeze)
69888990|Kab. Malaka|Io Kufeu
69993057|Kab. Belu|Kakuluk Mesak
69975241|Kab. Alor|Pantar Barat Laut
69990872|Kab. Sikka|Kangae
70031959|Kab. Sumba Timur|Katala Hamu Lingu
69946086|Kota Kupang|Oebobo
69878677|Kab. Flores Timur|Kelubagolit
70006452|Kab. Timor Tengah Selatan|Amanuban Selatan
69948506|Kab. Alor|Alor Timur
69988075|Kab. Timor Tengah Selatan|Kot\`Olin
69902442|Kab. Malaka|Laenmanen
69981389|Kab. Belu|Lasiolat
69900214|Kab. Sumba Timur|Lewa Tidahu
69864623|Kab. Alor|Alor Tengah Utara
69864615|Kab. Sikka|Magependa
69946432|Kab. Belu|Lamakmen
69962131|Kab. Sumba Timur|Matawai La Pawu
70013307|Kab. Timor Tengah Selatan|Nunbena
50302620|Kab. Ende|Maurole
69772588|Kab. Timor Tengah Utara|Miomafo Tengah
70041385|Kab. Ende|Kota Baru
69989137|Kab. Timor Tengah Selatan|Kie
70013634|Kab. Timor Tengah Selatan|Noebeba
69896247|Kab. Timor Tengah Utara|Noemuti Timur
69847627|Kab. Timor Tengah Selatan|Nunbena
69981042|Kab. Timor Tengah Selatan|Nunkolo
69894295|Kab. Timor Tengah Utara|Insana Utara
70006491|Kab. Timor Tengah Selatan|Kolbano
69799865|Kab. Sikka|Alok
70032352|Kab. Belu|Lamakmen Selatan
69877329|Kab. Alor|Alor Timur Laut
70011428|Kab. Sumba Timur|Pinu Pahar
50308603|Kab. Manggarai Timur|Lamba Leda Timur (Poco Ranaka Timur)
69734401|Kab. Ende|Pulau Ende
69979856|Kab. Belu|Rai Manuk
70041021|Kab. Alor|Alor Barat Laut
70011899|Kab. Sikka|Doreng
70032235|Kab. Timor Tengah Selatan|Kot\`Olin
70033862|Kab. Alor|Alor Tengah Utara
70026924|Kab. Alor|Alor Selatan
70053816|Kab. Alor|Pantar Timur
70033583|Kab. Timor Tengah Selatan|Kie
70006451|Kab. Timor Tengah Selatan|Boking
69987799|Kab. Timor Tengah Selatan|Kuanfatu
70016034|Kab. Timor Tengah Selatan|Nunkolo
70012744|Kab. Timor Tengah Selatan|Mollo Barat
70013321|Kab. Timor Tengah Selatan|Toianas
69897125|Kab. Malaka|Sasitamean
69948621|Kab. Alor|Alor Selatan
70038167|Kab. Alor|Pantar Timur
69939617|Kab. Timor Tengah Selatan|Tobu
69903967|Kab. Timor Tengah Selatan|Kualin
70036796|Kab. Timor Tengah Selatan|BatuPutih
69904815|Kab. Timor Tengah Selatan|Polen
69971102|Kab. Sikka|Waiblama
69889079|Kab. Malaka|Wewiku
69899565|Kab. Malaka|Weliman
69839276|Kab. Ende|Wewaria
70011407|Kab. Kupang|Fatuleu
69981634|Kab. Timor Tengah Selatan|Noebeba
69939495|Kab. Alor|Teluk Mutiara
69883508|Kab. Sumba Barat Daya|Kota Tambolaka
50303793|Kab. Sumba Timur|Kota Waingapu
69947798|Kab. Sikka|Alok Barat
69870904|Kota Kupang|Alak
69969786|Kab. Malaka|Malaka Tengah
69895838|Kab. Sumba Barat Daya|Wewewa Timur
69895841|Kab. Sumba Barat Daya|Kodi Utara
69897141|Kab. Malaka|Malaka Barat
70009620|Kab. Malaka|Malaka Barat
69895839|Kab. Sumba Barat Daya|Wewewa Selatan
69822783|Kab. Malaka|Malaka Barat
70039488|Kab. Sumba Barat Daya|Kodi
70003150|Kab. Belu|Kota Atambua
70027436|Kab. Malaka|Weliman
69870671|Kab. Ngada|Golewa
69987476|Kab. Malaka|Malaka Barat
69988292|Kota Kupang|Oebobo
50301403|Kab. Belu|Atambua Barat
69987823|Kota Kupang|Kelapa Lima
50300260|Kab. Kupang|Amarasi
70036039|Kab. Sabu Raijua|Sabu Timur
70047453|Kab. Timor Tengah Selatan|Kualin
69978320|Kab. Malaka|Botin Leobele
69979990|Kab. Malaka|Malaka Tengah
69978354|Kab. Malaka|Malaka Timur
50300261|Kab. Kupang|Sulamu
50306151|Kab. Flores Timur|Ile Boleng
70011652|Kab. Flores Timur|Ilebura
50301896|Kab. Flores Timur|Larantuka
50301878|Kab. Flores Timur|Larantuka
69966104|Kab. Lembata|Nubatukan
70036877|Kab. Sumba Barat Daya|Wewewa Timur
69947662|Kab. Sumba Barat Daya|Kota Tambolaka
50301887|Kab. Flores Timur|Adonara Timur
69978370|Kota Kupang|Kota Lama
70047415|Kab. Rote Ndao|Landu Leko
50301885|Kab. Flores Timur|Larantuka
70010693|Kota Kupang|Maulafa
50301879|Kab. Flores Timur|Adonara Timur
69947958|Kab. Sumba Barat Daya|Kodi Bangedo
70015903|Kab. Sumba Barat Daya|Kodi
69846046|Kab. Belu|Atambua Selatan
50309323|Kab. Belu|Tasifeto Barat
69986032|Kota Kupang|Alak
50305399|Kab. Ende|Ende Tengah
50309006|Kota Kupang|Alak
69895842|Kab. Sumba Barat Daya|Kodi Bangedo
69895840|Kab. Sumba Barat Daya|Wewewa Barat
69896150|Kab. Sumba Barat Daya|Wewewa Barat
50305305|Kab. Sikka|Alok
50307410|Kab. Timor Tengah Utara|Noemuti
50309015|Kab. Nagekeo|Aesesa
50302954|Kab. Ngada|Aimere
50300583|Kab. Timor Tengah Selatan|Amanuban Selatan
50307291|Kab. Timor Tengah Selatan|Amanuban Tengah
50300584|Kab. Timor Tengah Selatan|Amanuban Timur
69734023|Kab. Kupang|Amfoang Barat Daya
69822785|Kab. Kupang|Amfoang Barat Laut
50309598|Kab. Kupang|Amfoang Selatan
50301404|Kab. Belu|Kota Atambua
50302956|Kab. Ngada|Bajawa
50302315|Kab. Sikka|Bola
50308365|Kab. Manggarai Barat|Boleng
50308593|Kab. Manggarai Timur|Rana Mese
50303425|Kab. Manggarai|Cibal
50308594|Kab. Manggarai Timur|Elar
50306571|Kab. Kupang|Fatuleu
50309599|Kab. Kupang|Fatuleu Barat
69725918|Kab. Kupang|Fatuleu Tengah
50306183|Kab. Ngada|Golewa Barat
69946949|Kab. Ngada|Golewa Selatan
69946999|Kab. Ngada|Golewa
69947000|Kab. Ngada|Inerie
50301007|Kab. Timor Tengah Utara|Insana
50301695|Kab. Alor|Teluk Mutiara
69822791|Kab. Sumba Timur|Kambera
50301006|Kab. Timor Tengah Utara|Kota Kefamenanu
50309259|Kab. Nagekeo|Keo Tengah
50304067|Kab. Sumba Barat Daya|Kodi
50304771|Kab. Manggarai Barat|Komodo
50308595|Kab. Manggarai Timur|Kota Komba
50304931|Kota Kupang|Oebobo
50300273|Kab. Kupang|Kupang Tengah
50300274|Kab. Kupang|Kupang Timur
50308981|Kab. Manggarai Barat|Kuwus
50308596|Kab. Manggarai Timur|Lamba Leda
60726234|Kab. Sumba Barat|Lamboya
50303429|Kab. Manggarai|Langke Rembong
69734147|Kab. Manggarai|Lelak
69733944|Kab. Manggarai Barat|Lembor
50308982|Kab. Manggarai Barat|Lembor Selatan
69733989|Kab. Sabu Raijua|Sabu Liae
50304604|Kab. Rote Ndao|Lobalain
50304068|Kab. Sumba Barat Daya|Loura
50304770|Kab. Manggarai Barat|Macang Pacar
50309603|Kab. Malaka|Malaka Barat
50309321|Kab. Malaka|Malaka Timur
69774869|Kab. Sumba Tengah|Mamboro
50302306|Kab. Sikka|Alok
50302955|Kab. Nagekeo|Mauponggo
50304775|Kab. Manggarai Barat|Mbeliling
50300585|Kab. Timor Tengah Selatan|Mollo Selatan
50304406|Kab. Lembata|Naga Wutung
50308364|Kab. Manggarai Barat|Ndoso
50302305|Kab. Sikka|Nita
50304405|Kab. Lembata|Nubatukan
50304605|Kab. Rote Ndao|Pantai Baru
50305901|Kab. Alor|Pantar
50308597|Kab. Manggarai Timur|Lamba Leda Selatan (Poco Ranaka)
69734148|Kab. Manggarai|Rahong Utara
50307941|Kab. Manggarai|Reok Barat
50307844|Kab. Ngada|Riung Barat
50304610|Kab. Rote Ndao|Rote Barat
50304606|Kab. Rote Ndao|Rote Barat Daya
50304607|Kab. Rote Ndao|Rote Barat Laut
50304608|Kab. Rote Ndao|Rote Tengah
50304609|Kab. Rote Ndao|Rote Timur
50307942|Kab. Manggarai|Ruteng
50300275|Kab. Sabu Raijua|Sabu Barat
69733990|Kab. Sabu Raijua|Sabu Tengah
50300276|Kab. Sabu Raijua|Sabu Timur
50308598|Kab. Manggarai Timur|Congkar
50308361|Kab. Manggarai Barat|Sano Nggoang
50303447|Kab. Manggarai|Satar Mese Barat
50306188|Kab. Ngada|Soa
50307294|Kab. Timor Tengah Selatan|Kota Soe
50301898|Kab. Flores Timur|Solor Barat
69822787|Kab. Kupang|Sulamu
50300267|Kab. Kupang|Taebenu
50307416|Kab. Timor Tengah Utara|Miomafo Timur
50302304|Kab. Sikka|Talibura
60726236|Kab. Sumba Barat|Tana Righu
50306149|Kab. Flores Timur|Tanjung Bunga
50309318|Kab. Belu|Tasifeto Barat
50309324|Kab. Belu|Tasifeto Timur
60726630|Kab. Sumba Tengah|Umbu Ratu Nggay Barat
50308363|Kab. Manggarai Barat|Welak
50309608|Kab. Sumba Barat Daya|Wewewa Selatan
50304081|Kab. Sumba Barat Daya|Wewewa Tengah
50309611|Kab. Sumba Barat Daya|Wewewa Utara
50308302|Kab. Nagekeo|Wolowae
50306170|Kota Kupang|Maulafa
60702920|Kota Kupang|Maulafa
69822788|Kab. Kupang|Amabi Oefeto Timur
69765062|Kab. Kupang|Amarasi
69758125|Kab. Kupang|Amarasi Selatan
69772619|Kab. Kupang|Amarasi Timur
69947184|Kab. Ngada|Bajawa
50308599|Kab. Manggarai Timur|Borong
69760873|Kab. Manggarai|Cibal Barat
50308601|Kab. Manggarai Timur|Elar Selatan
50309614|Kab. Kupang|Fatuleu
69765060|Kab. Kupang|Fatuleu Barat
69772616|Kab. Kupang|Fatuleu Tengah
50305902|Kab. Alor|Teluk Mutiara
50301005|Kab. Timor Tengah Utara|Kota Kefamenanu
50308980|Kab. Manggarai Barat|Komodo
50308602|Kab. Manggarai Timur|Kota Komba
50304930|Kota Kupang|Kelapa Lima
60728880|Kab. Kupang|Kupang Barat
69768296|Kab. Kupang|Kupang Tengah
50300259|Kab. Kupang|Kupang Timur
69775289|Kab. Manggarai Barat|Kuwus Barat
50310686|Kab. Manggarai Timur|Lamba Leda Utara
50303316|Kab. Manggarai|Langke Rembong
50310801|Kab. Manggarai Barat|Lembor Selatan
50302295|Kab. Sikka|Alok
50305137|Kab. Lembata|Nubatukan
69760874|Kab. Manggarai|Rahong Utara
50308604|Kab. Manggarai Timur|Sambi Rampas
50308362|Kab. Manggarai Barat|Sano Nggoang
69726058|Kab. Manggarai|Satar Mese Utara
69774728|Kab. Kupang|Taebenu
69972601|Kab. Nagekeo|Aesesa
50309258|Kab. Manggarai Timur|Borong
50308605|Kab. Manggarai Timur|Elar Selatan
50309616|Kab. Kupang|Fatuleu
50309284|Kab. Manggarai Timur|Kota Komba Utara
50305119|Kota Kupang|Oebobo
69768157|Kab. Manggarai Timur|Lamba Leda
50309283|Kab. Manggarai Timur|Lamba Leda Timur (Poco Ranaka Timur)
50309282|Kab. Manggarai Timur|Congkar
69726059|Kab. Manggarai|Satarmese
50309280|Kab. Manggarai Timur|Borong
69768161|Kab. Manggarai Timur|Elar Selatan
50310687|Kab. Manggarai Timur|Kota Komba Utara
50305120|Kota Kupang|Kelapa Lima
69768158|Kab. Manggarai Timur|Lamba Leda Utara
50310691|Kab. Manggarai Timur|Lamba Leda Selatan (Poco Ranaka)
69725270|Kab. Manggarai Timur|Congkar
70006140|Kab. Manggarai|Satarmese
50309281|Kab. Manggarai Timur|Borong
69768162|Kab. Manggarai Timur|Elar Selatan
50310688|Kab. Manggarai Timur|Kota Komba Utara
50304947|Kota Kupang|Oebobo
69768159|Kab. Manggarai Timur|Lamba Leda Selatan (Poco Ranaka)
50310684|Kab. Manggarai Timur|Rana Mese
69888802|Kab. Manggarai Timur|Elar
50310689|Kab. Manggarai Timur|Kota Komba
50304946|Kota Kupang|Maulafa
69768160|Kab. Manggarai Timur|Lamba Leda Selatan (Poco Ranaka)
50310685|Kab. Manggarai Timur|Borong
69888773|Kab. Manggarai Timur|Elar
50310690|Kab. Manggarai Timur|Kota Komba
50304945|Kota Kupang|Maulafa
69888717|Kab. Manggarai Timur|Lamba Leda Timur (Poco Ranaka Timur)
69768163|Kab. Manggarai Timur|Borong
69888662|Kab. Manggarai Timur|Kota Komba Utara
50305121|Kota Kupang|Alak
69888718|Kab. Manggarai Timur|Lamba Leda Selatan (Poco Ranaka)
69768164|Kab. Manggarai Timur|Rana Mese
50304943|Kota Kupang|Kelapa Lima
69862588|Kab. Malaka|Kobalima Timur
69762588|Kab. Alor|Alor Selatan
69762590|Kab. Alor|Alor Tengah Utara
69759213|Kab. Alor|Alor Barat Laut
50300586|Kab. Timor Tengah Selatan|Amanatun Utara
50305903|Kab. Alor|Pantar Barat
50309196|Kab. Timor Tengah Selatan|BatuPutih
50307413|Kab. Timor Tengah Utara|Biboki Anleu
69728422|Kab. Timor Tengah Utara|Bikomi Nilulat
50309322|Kab. Malaka|Rinhat
69882386|Kab. Timor Tengah Selatan|Toianas
69862587|Kab. Malaka|Malaka Tengah
69759214|Kab. Alor|Abad Selatan
50309579|Kab. Timor Tengah Utara|Insana Fafinesu
69728423|Kab. Timor Tengah Utara|Insana Barat
69728420|Kab. Timor Tengah Utara|Insana Tengah
69889073|Kab. Alor|Kabola
50300587|Kab. Timor Tengah Selatan|Mollo Utara
69985439|Kab. Timor Tengah Selatan|Kok Baun
50307298|Kab. Timor Tengah Selatan|Kualin
50307299|Kab. Timor Tengah Selatan|Kuanfatu
69822782|Kab. Alor|Pantar
69762587|Kab. Alor|Alor Timur
50300984|Kab. Timor Tengah Utara|Biboki Utara
69771356|Kab. Alor|Alor Barat Daya
69727470|Kab. Timor Tengah Utara|Naibenu
50307411|Kab. Timor Tengah Utara|Biboki Selatan
69762589|Kab. Alor|Mataru
69759212|Kab. Alor|Pantar Tengah
69727469|Kab. Timor Tengah Utara|Mutis
50301003|Kab. Timor Tengah Utara|Miomafo Barat
50309194|Kab. Timor Tengah Selatan|Noebana
50307414|Kab. Timor Tengah Utara|Noemuti
50309195|Kab. Timor Tengah Selatan|Toianas
69987673|Kab. Timor Tengah Selatan|Oenino
50301004|Kab. Timor Tengah Utara|Biboki Tanpah
50309622|Kab. Timor Tengah Selatan|Amanatun Selatan
50307415|Kab. Timor Tengah Utara|Biboki Moenleu
69762591|Kab. Alor|Alor Barat Daya
69889074|Kab. Alor|Pulau Pura
69774849|Kab. Alor|Pureman
50305307|Kab. Sikka|Paga
50305376|Kab. Rote Ndao|Rote Selatan
50307301|Kab. Timor Tengah Selatan|Santian
50305898|Kab. Alor|Pantar Timur
69862586|Kab. Malaka|Kobalima
50305406|Kab. Ende|Wolojita
69762592|Kab. Alor|Alor Barat Daya
50301400|Kab. Malaka|Wewiku
50309473|Kab. Belu|Atambua Barat
50300243|Kab. Kupang|Kupang Tengah
50300664|Kab. Timor Tengah Selatan|Kota Soe
50304949|Kota Kupang|Maulafa
50302309|Kab. Sikka|Alok Timur
50301401|Kab. Belu|Atambua Barat
50303442|Kab. Manggarai|Langke Rembong
50309383|Kab. Malaka|Malaka Tengah
50303443|Kab. Manggarai|Langke Rembong
50303445|Kab. Manggarai|Ruteng
69760655|Kab. Timor Tengah Utara|Kota Kefamenanu
50307282|Kab. Timor Tengah Selatan|Kota Soe
50305261|Kota Kupang|Kota Raja
69822789|Kab. Kupang|Kupang Tengah
50309581|Kab. Malaka|Weliman
50308513|Kota Kupang|Alak
50309120|Kab. Lembata|Nubatukan
50300257|Kab. Kupang|Amarasi
50310786|Kab. Lembata|Ile Ape
50308592|Kab. Manggarai Timur|Borong
50308607|Kab. Manggarai Timur|Kota Komba Utara
50309224|Kab. Manggarai Barat|Macang Pacar
50304066|Kab. Sumba Barat|Kota Waikabubak
50303446|Kab. Manggarai|Langke Rembong
50300665|Kab. Timor Tengah Selatan|Mollo Selatan
50304065|Kab. Sumba Barat Daya|Kota Tambolaka
50302314|Kab. Sikka|Alok
69968724|Kab. Sikka|Alok
50302951|Kab. Ngada|Riung
50301881|Kab. Flores Timur|Witihama
50302312|Kab. Sikka|Hewokloang
69734157|Kab. Sumba Barat|Loli
50304937|Kota Kupang|Maulafa
50302311|Kab. Sikka|Alok Timur
50302957|Kab. Ngada|Golewa
50301674|Kab. Alor|Teluk Mutiara
50305262|Kota Kupang|Maulafa
50307284|Kab. Timor Tengah Selatan|Kota Soe
50301675|Kab. Alor|Teluk Mutiara
69767796|Kota Kupang|Kota Raja
50300683|Kab. Timor Tengah Selatan|Kota Soe
50307286|Kab. Timor Tengah Selatan|Amanatun Selatan
50309375|Kab. Belu|Kota Atambua
50309198|Kab. Timor Tengah Selatan|Boking
69726555|Kota Kupang|Kota Raja
50305347|Kab. Rote Ndao|Loaholu
50307287|Kab. Timor Tengah Selatan|Mollo Utara
50307288|Kab. Timor Tengah Selatan|Kuatnana
50305118|Kota Kupang|Kota Raja
50307289|Kab. Timor Tengah Selatan|Santian
50300258|Kab. Kupang|Kupang Tengah
50300256|Kab. Kupang|Amarasi
50304061|Kab. Sumba Barat|Kota Waikabubak
50304062|Kab. Sumba Barat|Loli
70008273|Kab. Malaka|Rinhat
50304063|Kab. Sumba Barat Daya|Loura
50301402|Kab. Belu|Lasiolat
50308366|Kab. Manggarai Barat|Boleng
50305899|Kab. Alor|Teluk Mutiara
50304935|Kota Kupang|Oebobo
50305306|Kab. Sikka|Alok Timur
50306082|Kota Kupang|Maulafa
69725921|Kab. Kupang|Fatuleu
50301008|Kab. Timor Tengah Utara|Kota Kefamenanu
50301886|Kab. Flores Timur|Wulang Gitang
50304934|Kota Kupang|Kota Raja
50302310|Kab. Sikka|Alok Timur
50307302|Kab. Timor Tengah Selatan|Amanuban Barat
50309192|Kab. Timor Tengah Selatan|Kie
50300582|Kab. Timor Tengah Selatan|Kota Soe
50304407|Kab. Lembata|Nubatukan
50300262|Kab. Sabu Raijua|Sabu Barat
69763284|Kota Kupang|Alak
50306573|Kab. Kupang|Kupang Tengah
50302958|Kab. Ngada|Bajawa
50304773|Kab. Manggarai Barat|Sano Nggoang
50309377|Kab. Belu|Tasifeto Barat
50310683|Kab. Sikka|Alok
50308606|Kab. Manggarai Timur|Kota Komba
50301877|Kab. Flores Timur|Wulang Gitang
50304064|Kab. Sumba Barat Daya|Kota Tambolaka
50304933|Kota Kupang|Oebobo
50303422|Kab. Manggarai|Langke Rembong
50302968|Kab. Nagekeo|Nangaroro
50309590|Kab. Malaka|Malaka Tengah
50302952|Kab. Nagekeo|Boawae
50303418|Kab. Manggarai|Langke Rembong
50304772|Kab. Manggarai Barat|Lembor
50303423|Kab. Manggarai|Langke Rembong
50302953|Kab. Nagekeo|Boawae
50307939|Kab. Manggarai|Reok
50309591|Kab. Malaka|Malaka Tengah
50304774|Kab. Manggarai Barat|Komodo
50303419|Kab. Manggarai|Ruteng
50307940|Kab. Manggarai|Satarmese
69774563|Kab. Manggarai Timur|Elar Selatan
50302313|Kab. Sikka|Kewapante
50303424|Kab. Manggarai|Langke Rembong
50309626|Kab. Sumba Barat Daya|Kota Tambolaka
50309374|Kab. Belu|Kota Atambua
50307304|Kab. Timor Tengah Selatan|Amanuban Tengah
50305384|Kota Kupang|Maulafa
69830518|Kab. Sumba Barat Daya|Kodi Utara
50309594|Kab. Belu|Kota Atambua
50305263|Kota Kupang|Maulafa
69752273|Kota Kupang|Oebobo
50308460|Kota Kupang|Kelapa Lima
50303421|Kab. Manggarai|Langke Rembong
50300263|Kab. Kupang|Amarasi
70053961|Kab. Sikka|Talibura
69947212|Kota Kupang|Kelapa Lima
69978535|Kab. Manggarai|Langke Rembong
70029990|Kab. Malaka|Kobalima
69978864|Kab. Ngada|Soa
69915186|Kab. Sikka|Hewokloang
70035167|Kab. Timor Tengah Selatan|Mollo Tengah
69847638|Kab. Timor Tengah Selatan|Mollo Utara
70048447|Kab. Timor Tengah Utara|Kota Kefamenanu
77644736|Kab. Timor Tengah Selatan|Mollo Selatan
70049459|Kab. Manggarai Barat|Macang Pacar
69786550|Kab. Belu|Atambua Selatan
70033545|Kab. Sikka|Kewapante
69774565|Kab. Manggarai Timur|Rana Mese
NP259283|Kab. Timor Tengah Utara|Kota Kefamenanu
70005384|Kab. Sumba Barat Daya|Wewewa Barat
69935090|Kab. Sumba Barat Daya|Kota Tambolaka
69895846|Kab. Sumba Barat Daya|Wewewa Timur
69895857|Kab. Sumba Barat Daya|Wewewa Utara
70040080|Kab. Nagekeo|Boawae
70035131|Kab. Sabu Raijua|Hawu Mehara
70047266|Kab. Lembata|Naga Wutung
70041648|Kab. Nagekeo|Aesesa
69900123|Kab. Sumba Timur|Rindi
69831984|Kab. Timor Tengah Utara|Kota Kefamenanu
70041430|Kab. Sumba Barat Daya|Wewewa Utara
69895845|Kab. Sumba Barat Daya|Wewewa Tengah
69990340|Kab. Ende|Ndona
69881354|Kab. Sumba Barat Daya|Kota Tambolaka
50305714|Kab. Ende|Ende Tengah
50309316|Kab. Belu|Tasifeto Barat
69903531|Kab. Sikka|Paga
69900741|Kab. Ngada|Soa
50305396|Kab. Ende|Ende Utara
70051023|Kab. Kupang|Fatuleu
69934107|Kab. Sumba Barat Daya|Kota Tambolaka
69900259|Kab. Timor Tengah Utara|Biboki Anleu
69981848|Kab. Timor Tengah Selatan|Kie
70047816|Kab. Kupang|Amarasi Selatan
69905530|Kab. Kupang|Kupang Tengah
69972270|Kab. Timor Tengah Selatan|Tobu
69949821|Kab. Timor Tengah Selatan|Fatumnasi
69972272|Kab. Timor Tengah Selatan|Mollo Barat
69895834|Kab. Sumba Barat Daya|Kodi Balaghar
69895844|Kab. Sumba Barat Daya|Wewewa Tengah
70050789|Kab. Kupang|Kupang Tengah
69900564|Kab. Sumba Barat Daya|Kodi Utara
69895852|Kab. Sumba Barat Daya|Wewewa Timur
70052241|Kab. Manggarai Barat|Komodo
70057428|Kab. Manggarai Timur|Sambi Rampas
70052999|Kab. Lembata|Omesuri
69980330|Kab. Manggarai|Reok
69985253|Kab. Sikka|Mego
69856248|Kab. Lembata|Atadei
69888596|Kab. Flores Timur|Adonara
69896139|Kab. Kupang|Amarasi
69939165|Kab. Kupang|Amarasi Barat
70012936|Kab. Kupang|Amfoang Tengah
70043706|Kab. Kupang|Amfoang Utara
70012907|Kab. Manggarai Barat|Boleng
50305392|Kab. Ende|Ende Timur
50301011|Kab. Timor Tengah Utara|Kota Kefamenanu
69881355|Kab. Sumba Barat Daya|Kodi Balaghar
69842629|Kab. Manggarai Barat|Lembor Selatan
69842630|Kab. Manggarai Barat|Macang Pacar
70052279|Kab. Manggarai Barat|Ndoso
69954192|Kab. Sumba Timur|Pandawai
70047212|Kab. Manggarai|Rahong Utara
70035675|Kab. Manggarai|Reok Barat
70010024|Kab. Ngada|Golewa
70024103|Kab. Manggarai|Satar Mese Barat
69774699|Kab. Sumba Timur|Tabundung
70032123|Kab. Kupang|Taebenu
70044135|Kab. Flores Timur|Titehena
69957059|Kab. Sumba Tengah|Umbu Ratu Nggay
70039100|Kab. Sumba Tengah|Umbu Ratu Nggay Tengah
50308343|Kab. Sumba Tengah|Umbu Ratu Nggay Barat
50303772|Kab. Sumba Timur|Kota Waingapu
70024101|Kab. Sumba Barat Daya|Wewewa Tengah
70010042|Kab. Ngada|Riung Selatan (Wolomeze)
70045155|Kab. Kupang|Amfoang Selatan
50302628|Kab. Ende|Ende Timur
69954174|Kab. Sumba Barat Daya|Kota Tambolaka
69966368|Kab. Sumba Barat|Lamboya
69857892|Kab. Sabu Raijua|Sabu Barat
69867911|Kab. Kupang|Takari
50303771|Kab. Sumba Timur|Kota Waingapu
70011318|Kab. Manggarai Barat|Welak
70035268|Kab. Manggarai Timur|Elar
50305393|Kab. Ende|Wewaria
70005734|Kab. Manggarai Barat|Komodo
69864616|Kab. Sikka|Alok Timur
69933884|Kab. Sumba Barat Daya|Wewewa Barat
50308523|Kab. Ende|Kota Baru
50308975|Kab. Ende|Maukaro
50305766|Kab. Sumba Timur|Kambera
69774700|Kab. Sumba Timur|Karera
69903685|Kab. Ende|Kelimutu
70035133|Kab. Sumba Timur|Lewa
70043298|Kab. Sumba Timur|Kambata Mapambuhang
70038323|Kab. Flores Timur|Adonara Barat
70029086|Kab. Timor Tengah Selatan|Kolbano
70012332|Kab. Timor Tengah Selatan|Kuanfatu
70050017|Kab. Manggarai|Ruteng
70039863|Kab. Kupang|Semau
70033793|Kab. Timor Tengah Utara|Biboki Feotleu
69872150|Kab. Timor Tengah Utara|Biboki Anleu
50306154|Kab. Flores Timur|Ile Boleng
69900339|Kab. Timor Tengah Utara|Insana Barat
69888528|Kab. Ngada|Jerebuu
50309364|Kab. Belu|Kakuluk Mesak
70010881|Kab. Nagekeo|Nangaroro
70006493|Kab. Timor Tengah Selatan|Oenino
69899750|Kab. Timor Tengah Utara|Noemuti
69889030|Kab. Belu|Lamakmen Selatan
69941983|Kab. Belu|Rai Manuk
70006278|Kab. Timor Tengah Selatan|Amanuban Selatan
50309398|Kab. Belu|Raihat
70029855|Kab. Manggarai Barat|Komodo
70035801|Kab. Manggarai|Wae Ri\`I
69895847|Kab. Sumba Barat Daya|Wewewa Timur
69831999|Kab. Ende|Ende Timur
69895850|Kab. Sumba Barat Daya|Wewewa Timur
70040948|Kab. Sumba Tengah|Mamboro
69895858|Kab. Sumba Barat Daya|Kodi
69980182|Kab. Ngada|Inerie
50302629|Kab. Ende|Ndona
70040051|Kab. Sumba Barat Daya|Wewewa Barat
69896077|Kab. Sumba Barat Daya|Wewewa Selatan
69734022|Kab. Kupang|Fatuleu
69896151|Kab. Sumba Barat Daya|Kodi Utara
50303344|Kab. Manggarai|Langke Rembong
69759088|Kab. Sumba Barat Daya|Loura
69969545|Kab. Malaka|Malaka Tengah
69990902|Kab. Ngada|Riung Barat
70029736|Kab. Sumba Barat Daya|Wewewa Tengah
69895849|Kab. Sumba Barat Daya|Wewewa Barat
69896152|Kab. Sumba Barat Daya|Loura
69901257|Kab. Ngada|Golewa
69990276|Kab. Manggarai Timur|Lamba Leda
70001991|Kab. Sikka|Alok Barat
70039968|Kab. Sumba Barat Daya|Kodi Bangedo
69842631|Kab. Manggarai Barat|Lembor Selatan
69899025|Kab. Timor Tengah Utara|Miomafo Timur
69900205|Kab. Timor Tengah Utara|Bikomi Utara
50306156|Kab. Flores Timur|Larantuka
50301893|Kab. Flores Timur|Larantuka
69962868|Kab. Manggarai|Langke Rembong
50308482|Kab. Flores Timur|Lewolema
70001784|Kab. Kupang|Amarasi Barat
70041269|Kab. Manggarai Barat|Lembor
70012225|Kab. Sikka|Waigete
69979220|Kab. Timor Tengah Selatan|Amanuban Barat
71012297|Kab. Timor Tengah Utara|Biboki Selatan
50301891|Kab. Flores Timur|Ile Mandiri
79980430|Kab. Lembata|Ile Ape
70045766|Kab. Lembata|Nubatukan
69962869|Kab. Manggarai|Langke Rembong
70032284|Kab. Ende|Lio Timur
72583858|Kab. Timor Tengah Utara|Insana Fafinesu
50301892|Kab. Flores Timur|Adonara Timur
70025653|Kab. Timor Tengah Utara|Miomafo Barat
50308483|Kab. Flores Timur|Lewolema
70039944|Kab. Sumba Barat Daya|Wewewa Selatan
50305395|Kab. Ende|Ende Utara
69895851|Kab. Sumba Barat Daya|Kota Tambolaka
70006045|Kab. Timor Tengah Selatan|Amanuban Timur
78655605|Kab. Timor Tengah Utara|Bikomi Selatan
69892779|Kab. Manggarai Timur|Borong
69872386|Kab. Timor Tengah Utara|Miomafo Tengah
70005057|Kab. Sikka|Nita
70039971|Kab. Sumba Barat Daya|Wewewa Barat
50304942|Kota Kupang|Oebobo
69900565|Kab. Sumba Barat Daya|Kota Tambolaka
69899118|Kab. Sumba Barat Daya|Wewewa Selatan
50305394|Kab. Ende|Ende Tengah
50302967|Kab. Nagekeo|Aesesa
69727854|Kab. Nagekeo|Aesesa Selatan
50306182|Kab. Ngada|Aimere
69763279|Kab. Kupang|Amabi Oefeto
69752276|Kab. Kupang|Amabi Oefeto Timur
69725916|Kab. Kupang|Amarasi Selatan
69728761|Kab. Kupang|Amfoang Barat Laut
69765059|Kab. Kupang|Amfoang Selatan
50309313|Kab. Belu|Atambua Selatan
50308608|Kab. Manggarai Timur|Borong
50305138|Kab. Lembata|Buyasuri
69768166|Kab. Manggarai Timur|Elar Selatan
50305139|Kab. Lembata|Ile Ape
50300265|Kab. Kupang|Kupang Timur
50305905|Kab. Alor|Teluk Mutiara
69727866|Kab. Sumba Barat Daya|Kodi
69757517|Kab. Sumba Barat Daya|Kodi Bangedo
69759089|Kab. Sumba Barat Daya|Kodi Utara
69726021|Kab. Manggarai Timur|Kota Komba
50304998|Kota Kupang|Oebobo
50308202|Kab. Manggarai Barat|Kuwus
50304778|Kab. Manggarai Barat|Komodo
50306165|Kab. Lembata|Wulandoni
50308609|Kab. Manggarai Timur|Lamba Leda Utara
60726239|Kab. Sumba Barat|Laboya Barat
50304390|Kab. Lembata|Nubatukan
50304612|Kab. Rote Ndao|Lobalain
50304071|Kab. Sumba Barat|Loli
69774953|Kab. Nagekeo|Nangaroro
50304613|Kab. Rote Ndao|Rote Barat
50300264|Kab. Sabu Raijua|Sabu Barat
69768165|Kab. Manggarai Timur|Congkar
50307306|Kab. Timor Tengah Selatan|Kota Soe
69815324|Kab. Sumba Barat|Tana Righu
50307943|Kab. Manggarai|Wae Ri\`I
50304079|Kab. Sumba Barat|Kota Waikabubak
60726238|Kab. Sumba Barat|Wanokaka
50308201|Kab. Manggarai Barat|Welak
69759090|Kab. Sumba Barat Daya|Wewewa Timur
50309372|Kab. Belu|Tasifeto Timur
69774562|Kab. Manggarai Timur|Elar Selatan
69775283|Kab. Manggarai Barat|Komodo
69888710|Kab. Manggarai Timur|Kota Komba
50304997|Kota Kupang|Kota Lama
69827625|Kab. Kupang|Kupang Barat
69888796|Kab. Manggarai Timur|Lamba Leda
50306093|Kab. Sikka|Alok Barat
69727077|Kab. Sumba Barat Daya|Wewewa Barat
50308996|Kab. Alor|Alor Tengah Utara
50304991|Kota Kupang|Kelapa Lima
50305770|Kab. Sumba Timur|Pahunga Lodu
50305904|Kab. Alor|Teluk Mutiara
50304992|Kota Kupang|Oebobo
50305769|Kab. Sumba Timur|Lewa
50305267|Kota Kupang|Kota Raja
50304940|Kota Kupang|Kelapa Lima
60702921|Kota Kupang|Alak
60702922|Kota Kupang|Maulafa
69864625|Kab. Alor|Alor Barat Laut
69754734|Kab. Alor|Alor Barat Laut
69757332|Kab. Alor|Pantar Timur
69894300|Kab. Timor Tengah Utara|Bikomi Selatan
50307308|Kab. Timor Tengah Selatan|Boking
69756418|Kab. Alor|Alor Timur Laut
69757276|Kab. Alor|Pantar Barat Laut
69772591|Kab. Malaka|Malaka Tengah
50309394|Kab. Malaka|Kobalima
50301671|Kab. Alor|Alor Barat Laut
69758212|Kab. Alor|Alor Selatan
69725863|Kab. Alor|Alor Timur
69758177|Kab. Alor|Pantar Tengah
69768282|Kab. Timor Tengah Utara|Noemuti
50309199|Kab. Timor Tengah Selatan|Nunkolo
69933644|Kab. Timor Tengah Utara|Biboki Tanpah
69867944|Kab. Alor|Pantar
50305348|Kab. Rote Ndao|Pantai Baru
50301010|Kab. Timor Tengah Utara|Insana Utara
50306189|Kab. Ngada|Riung
50309391|Kab. Malaka|Sasitamean
50302300|Kab. Sikka|Talibura
50307311|Kab. Timor Tengah Selatan|Toianas
50309397|Kab. Malaka|Wewiku
69883260|Kab. Ngada|Golewa Barat
50309204|Kab. Timor Tengah Selatan|Kuanfatu
50303342|Kab. Manggarai|Langke Rembong
69775286|Kab. Manggarai Barat|Komodo
50302297|Kab. Sikka|Nelle
50305264|Kota Kupang|Kelapa Lima
50307419|Kab. Timor Tengah Utara|Miomafo Tengah
50308936|Kota Kupang|Kota Lama
50306575|Kab. Kupang|Sulamu
50308524|Kab. Manggarai|Langke Rembong
50304392|Kab. Lembata|Nubatukan
50309261|Kab. Manggarai|Langke Rembong
50304994|Kota Kupang|Oebobo
50303343|Kab. Manggarai|Langke Rembong
69765815|Kab. Sikka|Alok Timur
50301013|Kab. Timor Tengah Utara|Kota Kefamenanu
50301399|Kab. Belu|Kota Atambua
50308303|Kab. Nagekeo|Boawae
50307417|Kab. Timor Tengah Utara|Insana
69768281|Kab. Ende|Ende Tengah
50304391|Kab. Lembata|Nubatukan
50306574|Kab. Kupang|Kupang Barat
50305265|Kota Kupang|Kelapa Lima
50309412|Kab. Rote Ndao|Rote Barat Daya
69757516|Kab. Sumba Barat Daya|Wewewa Timur
50305266|Kota Kupang|Kota Raja
50304995|Kota Kupang|Kota Raja
50309163|Kab. Timor Tengah Selatan|Fautmolo
50309053|Kab. Timor Tengah Selatan|Amanuban Tengah
50309049|Kab. Timor Tengah Selatan|Amanatun Selatan
50300588|Kab. Timor Tengah Selatan|Kota Soe
50310692|Kab. Lembata|Nubatukan
50304611|Kab. Rote Ndao|Rote Barat Laut
50304996|Kota Kupang|Kelapa Lima
50309206|Kab. Timor Tengah Selatan|Amanuban Timur
50304941|Kota Kupang|Oebobo
50304993|Kota Kupang|Kelapa Lima
50302959|Kab. Ngada|Bajawa
50309203|Kab. Timor Tengah Selatan|Amanuban Barat
60728905|Kab. Kupang|Amabi Oefeto Timur
69786214|Kab. Kupang|Kupang Tengah
50304377|Kab. Lembata|Nubatukan
50305908|Kab. Sikka|Alok
50305308|Kab. Sikka|Lela
50302301|Kab. Sikka|Alok Timur
50302302|Kab. Sikka|Alok
50301398|Kab. Malaka|Malaka Tengah
69733979|Kab. Timor Tengah Utara|Kota Kefamenanu
50309417|Kab. Manggarai|Langke Rembong
50304779|Kab. Manggarai Barat|Komodo
50302303|Kab. Sikka|Kewapante
69774730|Kab. Kupang|Kupang Tengah
50308481|Kab. Timor Tengah Selatan|Kota Soe
50306576|Kab. Kupang|Kupang Timur
50303347|Kab. Manggarai|Langke Rembong
50304970|Kota Kupang|Oebobo
69725865|Kab. Alor|Teluk Mutiara
50302316|Kab. Sikka|Alok Barat
50302270|Kab. Sikka|Alok Timur
`;
  const WILAYAH = {};
  WILAYAH_RAW.trim().split('\n').forEach(line => {
    const p = line.split('|');
    const npsn = (p[0] || '').trim();
    if (npsn) WILAYAH[npsn] = { kab: (p[1] || '').trim(), kec: (p[2] || '').trim() };
  });
  const wil = npsn => WILAYAH[npsn] || { kab: '', kec: '' };
  const simpanMurid = () => CFG.MODE_DATA !== 'rekap' && CFG.STORE_STUDENTS !== false;
  const SESS_FALLBACK = 'FFD3D5C5-9E89-4EC6-A027-C88B85C80C43';
  const detectSess = () => {
    const m = document.documentElement.innerHTML.match(/refsp\/q\/([0-9A-F-]{36})/i);
    return m ? m[1] : '';
  };
  let SESS = detectSess() || SESS_FALLBACK;

  // halaman Dapodik memuat isi secara dinamis -> UUID sesi bisa baru muncul belakangan
  const ensureSess = () => {
    const s = detectSess();
    if (s && s !== SESS) {
      SESS = s;
      console.log('%c[userscript] sesi diperbarui', 'color:#2ecc71', s.slice(0, 8) + '…');
    }
    return SESS;
  };

  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const pause = () => wait(curDelay + Math.random() * CFG.JITTER);

  const state = JSON.parse(localStorage.getItem(CFG.KEY) || 'null') || {
    startedAt: Date.now(),
    sess: SESS,
    schools: {},
    done: {},
    rows: [],
    file: 0
  };

  let stopped = false;
  let running = false;
  let flushing = false;
  let ok = 0;
  let skip = 0;
  let gagal = 0;

  // --- metrik kecepatan ---
  let reqCount = 0;
  let curDelay = CFG.DELAY;
  let blockHits = 0;
  let lastBlocked = null;
  const tStart = Date.now();

  const stats = () => {
    const elapsed = (Date.now() - tStart) / 1000;
    const rps = elapsed > 0 ? reqCount / elapsed : 0;
    const done = Object.keys(state.done).length;
    const perSchool = done > 0 ? elapsed / done : 0;
    const sisa = Math.max(0, queue.length - done) * perSchool;
    return {
      request: reqCount,
      req_per_detik: Number(rps.toFixed(2)),
      sekolah_selesai: done,
      total: queue.length,
      persen: queue.length ? Number(((done / queue.length) * 100).toFixed(1)) : 0,
      delay_ms: curDelay,
      detik_per_sekolah: Number(perSchool.toFixed(1)),
      eta_menit: Math.round(sisa / 60),
      ok, skip, gagal,
      blokir_terakhir: lastBlocked
    };
  };

  const progressLine = () => {
    const s = stats();
    return '[' + s.sekolah_selesai + '/' + s.total + '] ' + s.persen + '% | ' +
      s.req_per_detik + ' req/s | delay ' + s.delay_ms + 'ms | ETA ' + s.eta_menit + ' mnt' +
      (s.gagal ? ' | gagal ' + s.gagal : '');
  };

  const save = () => {
    try { localStorage.setItem(CFG.KEY, JSON.stringify(state)); } catch (e) {}
  };

  const req = async (url, opt) => {
    let netAttempt = 0;

    while (true) {
      let r;
      try {
        r = await fetch(url, Object.assign({
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }, opt || {}));
      } catch (netErr) {
        if (++netAttempt > CFG.RETRY) throw netErr;
        await wait(900 * netAttempt);
        continue;
      }

      const text = await r.text();
      reqCount++;

      if (r.status === 200) {
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        return { status: 200, text, json };
      }

      // blokir WAF -> cooldown lalu perlambat, boleh pulih beberapa kali
      if (CFG.BLOCK_CODES.indexOf(r.status) !== -1) {
        lastBlocked = { kode: r.status, waktu: new Date().toISOString() };

        if (blockHits < CFG.MAX_RECOVER) {
          blockHits++;
          curDelay = Math.min(CFG.MAX_DELAY, curDelay + 250);
          console.warn('%c⏸ diblokir HTTP ' + r.status + ' — cooldown ' +
            Math.round(CFG.COOLDOWN / 1000) + 's, delay dinaikkan ke ' + curDelay + 'ms' +
            ' (pemulihan ' + blockHits + '/' + CFG.MAX_RECOVER + ')', 'color:#e67e22;font-weight:bold');
          await wait(CFG.COOLDOWN);
          continue;
        }

        const err = new Error('DIBLOKIR HTTP ' + r.status + (text ? ' — ' + text.slice(0, 100) : ''));
        err.block = true;
        err.status = r.status;
        throw err;
      }

      if (++netAttempt > CFG.RETRY) {
        throw new Error('HTTP ' + r.status + ' — ' + url);
      }
      await wait(900 * netAttempt);
    }
  };

  const cariSid = async npsn => {
    const { json } = await req('/refsp/q/' + ensureSess(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ q: npsn }).toString()
    });
    if (!Array.isArray(json)) return null;
    const row = json.find(r => Array.isArray(r) && r.some(v => String(v) === String(npsn)));
    if (!row) return null;
    const sid = row.find(v => typeof v === 'string' && GUID.test(v));
    return sid ? { sid, nama: row[1] || '' } : null;
  };

  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

  const download = (name, text, mime) => {
    const isJson = mime === 'application/json';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(
      [isJson ? text : '\ufeff' + text],
      { type: mime || 'text/csv;charset=utf-8' }
    ));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };

  const flushStudents = () => {
    if (!state.rows.length || flushing) return;
    flushing = true;
    const head = 'npsn,nama_sekolah,kabupaten_kota,kecamatan,tahun_lulus,nama,jenis_kelamin,tanggal_lahir,nik,nisn,nama_ibu_kandung\n';
    const body = state.rows.map(r => r.map(esc).join(',')).join('\n');
    state.file += 1;
    const name = 'lulusan_ntt_' + String(state.file).padStart(3, '0') + '.csv';
    download(name, (CFG.SEP_LINE ? 'sep=,\n' : '') + head + body);
    console.log('%c⬇ ' + name + ' — ' + state.rows.length + ' baris', 'color:#06c;font-weight:bold');
    state.rows = [];
    flushing = false;
    save();
  };

  const flushRekap = () => {
    const head = 'npsn,nama_sekolah,kabupaten_kota,kecamatan,jml_2022,jml_2023,jml_2024,jml_2025,jml_2026,total\n';
    const body = Object.keys(state.done).sort().map(npsn => {
      const c = state.done[npsn] || {};
      const s = state.schools[npsn] || {};
      const w = wil(npsn);
      const vals = CFG.TAHUN.map(y => (c[y] == null ? '' : c[y]));
      const total = CFG.TAHUN.reduce((a, y) => a + (c[y] || 0), 0);
      return [npsn, s.nama || '', w.kab, w.kec, ...vals, total].map(esc).join(',');
    }).join('\n');
    download('rekap_lulusan_ntt.csv', (CFG.SEP_LINE ? 'sep=,\n' : '') + head + body);
    console.log('%c⬇ rekap_lulusan_ntt.csv — ' + Object.keys(state.done).length + ' sekolah', 'color:#06c;font-weight:bold');

    if (CFG.REKAP_KABUPATEN) {
      const agg = {};
      Object.keys(state.done).forEach(npsn => {
        const kab = wil(npsn).kab || '(tidak diketahui)';
        if (!agg[kab]) agg[kab] = { n: 0, c: {} };
        agg[kab].n++;
        CFG.TAHUN.forEach(y => {
          agg[kab].c[y] = (agg[kab].c[y] || 0) + (state.done[npsn][y] || 0);
        });
      });

      const head2 = 'kabupaten_kota,jml_sekolah,' +
        CFG.TAHUN.map(y => 'jml_' + y).join(',') + ',total\n';
      const body2 = Object.keys(agg).sort().map(kab => {
        const a = agg[kab];
        const vals = CFG.TAHUN.map(y => a.c[y] || 0);
        const tot = vals.reduce((x, y) => x + y, 0);
        return [kab, a.n, ...vals, tot].map(esc).join(',');
      }).join('\n');

      download('rekap_kabupaten_ntt.csv', (CFG.SEP_LINE ? 'sep=,\n' : '') + head2 + body2);
      const totalSemua = Object.values(agg)
        .reduce((a, x) => a + CFG.TAHUN.reduce((b, y) => b + (x.c[y] || 0), 0), 0);
      console.log('%c⬇ rekap_kabupaten_ntt.csv — ' + Object.keys(agg).length +
        ' kabupaten · ' + totalSemua + ' lulusan', 'color:#06c;font-weight:bold');
    }
  };

  const queue = CFG.LIMIT > 0 ? NPSN.slice(0, CFG.LIMIT) : NPSN;
  let cursor = 0;

  const nextNpsn = () => (cursor < queue.length ? queue[cursor++] : null);

  const postSearch = q => req('/refsp/q/' + ensureSess(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ q }).toString()
  });

  /* ---- probe: ukur batas aman terhadap WAF + uji batch kabupaten ---- */
  const probe = async () => {
    const coba = async (label, q) => {
      try {
        const { json } = await postSearch(q);
        const n = Array.isArray(json) ? json.length : 0;
        console.log('%c✔ ' + label, 'color:#0a0;font-weight:bold', { baris: n });
        return { label, ok: true, n, json };
      } catch (e) {
        console.warn('%c✘ ' + label, 'color:#c00;font-weight:bold', e.message);
        return { label, ok: false, err: e.message };
      }
    };

    console.log('%cPROBE', 'color:#06c;font-weight:bold',
      'mengukur jumlah request paralel yang diizinkan. Total ±20 detik.');

    const hasil = [];
    await wait(2500);

    hasil.push(await coba('tunggal', '50301935'));
    await wait(2500);

    hasil.push(await Promise.all([
      coba('paralel-2 #a', '70055686'),
      coba('paralel-2 #b', '74986808')
    ]).then(r => ({ label: 'paralel-2', ok: r.every(x => x.ok), n: r.reduce((a, x) => a + (x.n || 0), 0) })));
    await wait(2500);

    hasil.push(await Promise.all([
      coba('paralel-3 #a', '50300269'),
      coba('paralel-3 #b', '75096361'),
      coba('paralel-3 #c', '70007712')
    ]).then(r => ({ label: 'paralel-3', ok: r.every(x => x.ok), n: r.reduce((a, x) => a + (x.n || 0), 0) })));
    await wait(3000);

    const kab = await coba('batch kabupaten', 'MANGGARAI BARAT');
    let kabCocok = null;
    if (kab.ok && Array.isArray(kab.json)) {
      kabCocok = kab.json.filter(r => Array.isArray(r) && String(r[3] || '').toUpperCase().includes('MANGGARAI BARAT')).length;
      console.log('  baris memuat "Manggarai Barat":', kabCocok, 'dari', kab.n);
    }

    const paralelOk = hasil.filter(h => h.ok && h.label.startsWith('paralel')).length;
    const aman = paralelOk >= 2 ? 3 : paralelOk >= 1 ? 2 : 1;

    console.log('%c== HASIL PROBE ==', 'color:#06c;font-weight:bold', hasil);
    console.log('%cREKOMENDASI', 'color:#0a0;font-weight:bold', {
      concurrency: aman,
      delay: aman === 1 ? 400 : 700,
      batch_kabupaten_bisa_dipakai: kabCocok > 0
    });
    if (aman === 1) {
      console.warn('Hanya 1 request pada satu waktu yang diizinkan. Pakai CONCURRENCY: 1.');
    }
    return { hasil, aman, kabCocok };
  };

  /* ---- probe2: cari jalur yang jauh lebih hemat request ---- */
  const probe2 = async () => {
    console.log('%cPROBE-2', 'color:#06c;font-weight:bold',
      'mencari endpoint/ekspor yang bisa memangkas jumlah request');

    // 1) fungsi unduh/ekspor bawaan halaman
    const kandidat = Object.keys(window).filter(k => /eksel|excel|export|cetak|unduh|download/i.test(k));
    kandidat.forEach(k => {
      if (typeof window[k] === 'function') {
        console.log('%c' + k + '()', 'color:#06c;font-weight:bold', String(window[k]).slice(0, 700));
      }
    });
    if (!kandidat.length) console.log('tidak ada fungsi ekspor global yang terdeteksi');

    // 2) sid contoh
    let sid = (Object.values(state.schools).filter(Boolean)[0] || {}).sid;
    if (!sid) {
      const r = await postSearch('50301935');
      if (Array.isArray(r.json) && Array.isArray(r.json[0])) {
        sid = r.json[0].find(v => typeof v === 'string' && GUID.test(v));
      }
    }
    console.log('sid contoh:', sid);
    if (!sid) { console.warn('sid tidak didapat, probe2 berhenti'); return; }

    const uji = async (label, url) => {
      try {
        const r = await fetch(url, {
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const t = await r.text();
        let n = null;
        try { const j = JSON.parse(t); n = Array.isArray(j) ? j.length : 'objek'; } catch (e) {}
        console.log('%c' + label, 'color:#0a0', {
          status: r.status, bytes: t.length, items: n,
          tipe: r.headers.get('content-type'), cuplikan: t.slice(0, 120)
        });
        return { label, status: r.status, bytes: t.length, items: n };
      } catch (e) {
        console.warn('%c' + label, 'color:#c00', e.message);
        return { label, error: e.message };
      }
    };

    const hasil = [];
    await wait(1500);
    hasil.push(await uji('sekolahpd tanpa tahun', '/ma74/sekolahpd/' + sid + '/4'));
    await wait(2500);
    hasil.push(await uji('sekolahpd tanpa status', '/ma74/sekolahpd/' + sid));
    await wait(2500);
    hasil.push(await uji('profil sekolah (HTML)', '/ma74/sekolah/' + sid));

    console.log('%c== RINGKASAN PROBE-2 ==', 'color:#06c;font-weight:bold', hasil);
    console.log('Kirim hasil ini — kalau salah satu endpoint mengembalikan data ' +
      'tanpa parameter tahun, jumlah request bisa turun 5x lipat.');
    return hasil;
  };

  window.__dapo = {
    cfg: CFG,
    state,
    probe,
    probe2,
    start: (...args) => start(...args),
    isRunning: () => running,
    queued: () => queue.length,
    stop() { stopped = true; save(); console.log('dihentikan; progres tersimpan'); },
    reset() { localStorage.removeItem(CFG.KEY); console.log('checkpoint dihapus'); },
    stats,
    sidExport() {
      const map = {};
      Object.keys(state.schools).forEach(npsn => {
        const s = state.schools[npsn];
        if (s && s.sid) map[npsn] = { sid: s.sid, nama: s.nama || '' };
      });
      const isi = {
        v: 2,
        dibuat: new Date().toISOString(),
        jumlah: Object.keys(map).length,
        sid: map
      };
      const nama = 'map_sid_' + Object.keys(map).length + '.json';
      download(nama, JSON.stringify(isi), 'application/json');
      console.log('%c⬇ ' + nama + ' — ' + Object.keys(map).length + ' sid',
        'color:#06c;font-weight:bold');
      return Object.keys(map).length;
    },
    sidImport(data) {
      try {
        let obj = data;
        if (typeof data === 'string') {
          obj = JSON.parse(data.replace(/^\ufeff/, ''));
        }
        const map = obj && obj.sid ? obj.sid : obj;
        let n = 0;
        Object.keys(map || {}).forEach(npsn => {
          const v = map[npsn];
          const sid = typeof v === 'string' ? v : (v && v.sid);
          const nama = (v && v.nama) || '';
          if (!state.schools[npsn] && typeof sid === 'string' && GUID.test(sid)) {
            state.schools[npsn] = { sid, nama };
            n++;
          }
        });
        save();
        console.log('%c✅ ' + n + ' sid diimpor (total tersimpan: ' +
          Object.values(state.schools).filter(Boolean).length + ')', 'color:#0a0;font-weight:bold');
        return n;
      } catch (e) {
        console.error('impor gagal:', e.message);
        return 0;
      }
    },
    rekap() {
      flushRekap();
      return {
        sekolah: Object.keys(state.done).length,
        mode: CFG.MODE_DATA
      };
    },
    delay(ms) {
      curDelay = Math.max(CFG.MIN_DELAY, Math.min(CFG.MAX_DELAY, Number(ms) || curDelay));
      console.log('delay sekarang:', curDelay + 'ms');
      return curDelay;
    },
    progress() {
      const s = stats();
      return Object.assign({}, s, {
        baris_tertunda: state.rows.length,
        file_csv: state.file
      });
    },
    eta() {
      const s = stats();
      return s.eta_menit + ' menit (≈' + s.detik_per_sekolah + 's/sekolah, ' +
        s.req_per_detik + ' req/s)';
    }
  };

  const start = async () => {
    if (running) { console.warn('proses masih berjalan'); return; }
    running = true;
    stopped = false;
    blockHits = 0;
    curDelay = CFG.DELAY;

    console.log('%cSTART', 'color:#0a0;font-weight:bold', {
      sekolah: queue.length,
      concurrency: CFG.CONCURRENCY,
      delay: CFG.DELAY + '+' + CFG.JITTER + 'ms',
      tahun: CFG.TAHUN.join(','),
      batch_kabupaten: CFG.BATCH_KABUPATEN,
      sess: SESS.slice(0, 8) + '…'
    });

    // opsional: selesaikan sid per kabupaten (22 request) sebelum loop utama
    if (CFG.BATCH_KABUPATEN) {
      const kabs = Array.from(new Set(Object.keys(WILAYAH).map(n => WILAYAH[n].kab).filter(Boolean)));
      console.log('prefetch sid per kabupaten:', kabs.length, 'wilayah');
      let zeroStreak = 0;
      for (const kab of kabs) {
        const q = kab.replace(/^Kab\.\s*/i, '').replace(/^Kota\s*/i, '').trim();
        try {
          const { json } = await postSearch(q);
          let n = 0;
          if (Array.isArray(json)) {
            for (const row of json) {
              if (!Array.isArray(row)) continue;
              const sid = row.find(v => typeof v === 'string' && GUID.test(v));
              const npsn = row.find(v => /^\d{8}$/.test(String(v)));
              if (sid && npsn && WILAYAH[npsn] && !state.schools[npsn]) {
                state.schools[npsn] = { sid, nama: row[1] || '' };
                n++;
              }
            }
          }
          console.log('  ' + kab + ' → ' + n + ' sid');
          zeroStreak = n ? 0 : zeroStreak + 1;
          if (zeroStreak >= 2 && Object.values(state.schools).filter(Boolean).length === 0) {
            console.warn('  batch kabupaten tidak didukung — lanjut cari sid per NPSN');
            break;
          }
        } catch (e) {
          console.warn('  ' + kab + ' gagal:', e.message);
          if (e.block) { stopped = true; break; }
        }
        await pause();
      }
      const punya = Object.values(state.schools).filter(Boolean).length;
      console.log('sid terkumpul: ' + punya + '/' + NPSN.length);
      save();
    }

    const worker = async (wid) => {
      while (!stopped) {
        const npsn = nextNpsn();
        if (!npsn) return;

        if (state.done[npsn]) { skip++; continue; }

        try {
          if (!state.schools[npsn]) {
            state.schools[npsn] = await cariSid(npsn);
            await pause();
          }
          const s = state.schools[npsn];
          if (!s) {
            gagal++;
            if (gagal <= 5 || gagal % 50 === 0) {
              console.warn('[w' + wid + '] ' + npsn + ' → sid tidak ditemukan (' + gagal + ' total)');
            }
            continue;
          }

          const counts = {};
          for (const th of CFG.TAHUN) {
            const { json } = await req('/ma74/sekolahpd/' + s.sid + '/4/' + th);
            counts[th] = Array.isArray(json) ? json.length : null;

            if (Array.isArray(json) && simpanMurid()) {
              const w = wil(npsn);
              for (const p of json) {
                state.rows.push([
                  npsn, s.nama, w.kab, w.kec, th, p.nama, p.jenis_kelamin,
                  p.tanggal_lahir, p.nik, p.nisn, p.nama_ibu_kandung
                ]);
              }
            }
            await pause();
          }

          state.done[npsn] = counts;
          ok++;

          console.log('[w' + wid + '] ' + npsn + ' ' + String(s.nama).slice(0, 32) + ' → ' +
            CFG.TAHUN.map(y => y + ':' + (counts[y] == null ? '-' : counts[y])).join(' '));

          if (ok % CFG.SAVE_EVERY === 0) save();
          if (state.rows.length >= CFG.ROWS_PER_CSV) flushStudents();

          // pacing adaptif: makin lancar, jeda makin pendek
          if (ok % CFG.SPEED_EVERY === 0 && curDelay > CFG.MIN_DELAY) {
            curDelay = Math.max(CFG.MIN_DELAY, curDelay - CFG.SPEED_STEP);
            console.log('%c⚡ ' + ok + ' sekolah lancar — delay turun ke ' + curDelay + 'ms',
              'color:#0a0');
          }

          if (ok % 25 === 0) {
            console.log('%c' + progressLine(), 'color:#888');
          }
        } catch (err) {
          if (err.block) {
            stopped = true;
            save();
            console.error('%c⛔ DIBLOKIR WAF (' + err.message + '). Proses dihentikan.', 'color:#c00;font-weight:bold',
              '\nLangkah pemulihan:\n' +
              '  1. Tunggu 5–10 menit (jangan request sama sekali).\n' +
              '  2. Jalankan __dapo.probe() untuk mengukur kecepatan aman.\n' +
              '  3. Pakai CONCURRENCY: 1 dan DELAY ≥ 400, lalu jalankan ulang.\n' +
              'Progres yang sudah ada tersimpan dan akan dilanjutkan (resume).');
            return;
          }
          gagal++;
          console.error('[w' + wid + '] ' + npsn + ' gagal:', err.message);
        }
      }
    };

    const t0 = Date.now();
    const live = setInterval(() => {
      if (!stopped) console.log('%c' + progressLine(), 'color:#888');
    }, 15000);

    const workers = [];
    for (let i = 1; i <= Math.max(1, CFG.CONCURRENCY); i++) workers.push(worker(i));
    await Promise.all(workers);

    clearInterval(live);
    flushStudents();
    flushRekap();

    const total = Object.keys(state.done)
      .reduce((a, n) => a + CFG.TAHUN.reduce((x, y) => x + (state.done[n][y] || 0), 0), 0);

    console.log('%c' + (stopped ? '■ DIHENTIKAN' : '✅ SELESAI'), 'color:#0a0;font-weight:bold', {
      sekolah: Object.keys(state.done).length,
      total_lulusan: total,
      ok, skip, gagal,
      request: reqCount,
      req_per_detik: stats().req_per_detik,
      delay_akhir_ms: curDelay,
      menit: ((Date.now() - t0) / 60000).toFixed(1),
      blokir: lastBlocked
    });

    running = false;
  };

  if (CFG.MODE === 'probe') probe();
  else if (CFG.MODE === 'probe2') probe2();
  else start();
})();
