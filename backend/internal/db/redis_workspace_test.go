package db

import "testing"

func TestParseRedisKeyspaceLine(t *testing.T) {
	cases := []struct {
		line  string
		want  bool
		stats struct {
			db      int
			keys    int64
			expires int64
			avgTTL  int64
		}
	}{
		{
			line: "db0:keys=12,expires=2,avg_ttl=3248914,subexpiry=0",
			want: true,
			stats: struct {
				db      int
				keys    int64
				expires int64
				avgTTL  int64
			}{0, 12, 2, 3248914},
		},
		{
			line: "db15:keys=1,expires=0",
			want: true,
			stats: struct {
				db      int
				keys    int64
				expires int64
				avgTTL  int64
			}{15, 1, 0, 0},
		},
		{line: "used_memory:1024", want: false},
		{line: "dbx:keys=1", want: false},
	}
	for _, test := range cases {
		got, ok := parseRedisKeyspaceLine(test.line)
		if ok != test.want {
			t.Fatalf("%q: ok=%v, want %v", test.line, ok, test.want)
		}
		if !test.want {
			continue
		}
		if got.DB != test.stats.db || got.Keys != test.stats.keys || got.Expires != test.stats.expires || got.AvgTTL != test.stats.avgTTL {
			t.Fatalf("%q: got %+v, want %+v", test.line, got, test.stats)
		}
	}
}
