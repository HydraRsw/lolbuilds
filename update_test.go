package main

import "testing"

func TestCmpVer(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{{"1.2.0", "1.2.0", 0}, {"1.10.0", "1.9.9", 1}, {"v1.2", "1.2.1", -1}, {"2", "1.99.99", 1}, {"", "0.0.1", -1}}
	for _, c := range cases {
		if got := cmpVer(c.a, c.b); got != c.want {
			t.Errorf("cmpVer(%q,%q)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}
