package auth

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"math/big"
	mathrand "math/rand"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	captchaChars    = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
	captchaCodeLen  = 4
	captchaTTL      = 5 * time.Minute
	captchaAttempts = 5
	captchaLocalMax = 10_000
)

type captchaEntry struct {
	code     string
	expireAt time.Time
	attempts int
}

type Captchas struct {
	mu    sync.Mutex
	local map[string]captchaEntry
}

func NewCaptchas() *Captchas {
	return &Captchas{local: make(map[string]captchaEntry)}
}

func (s *Captchas) Generate(dev bool) CaptchaChallenge {
	code := randomCaptchaCode(captchaCodeLen)
	id := strings.ReplaceAll(uuid.NewString(), "-", "")
	now := time.Now()
	s.mu.Lock()
	if len(s.local) >= captchaLocalMax {
		for key, entry := range s.local {
			if entry.expireAt.Before(now) {
				delete(s.local, key)
			}
		}
		if len(s.local) >= captchaLocalMax {
			s.local = map[string]captchaEntry{}
		}
	}
	s.local[id] = captchaEntry{code: code, expireAt: now.Add(captchaTTL)}
	s.mu.Unlock()
	imageData := renderCaptcha(code)
	challenge := CaptchaChallenge{CaptchaID: id, ImageBase64: imageData}
	if dev {
		challenge.DevCode = code
	}
	return challenge
}

func (s *Captchas) Verify(id, input string) bool {
	id = strings.TrimSpace(id)
	input = strings.TrimSpace(input)
	if id == "" || input == "" {
		return false
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.local[id]
	if !ok {
		return false
	}
	if entry.expireAt.Before(now) {
		delete(s.local, id)
		return false
	}
	if !strings.EqualFold(entry.code, input) {
		entry.attempts++
		if entry.attempts >= captchaAttempts {
			delete(s.local, id)
		} else {
			s.local[id] = entry
		}
		return false
	}
	delete(s.local, id)
	return true
}

func randomCaptchaCode(length int) string {
	var b strings.Builder
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(captchaChars))))
		if err != nil {
			b.WriteByte(captchaChars[i%len(captchaChars)])
			continue
		}
		b.WriteByte(captchaChars[n.Int64()])
	}
	return b.String()
}

// ==================== 图片渲染（标准库点阵字体） ====================

var captchaFont = map[byte][7]uint8{
	'2': {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F},
	'3': {0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E},
	'4': {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02},
	'5': {0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E},
	'6': {0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E},
	'7': {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08},
	'8': {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E},
	'9': {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C},
	'A': {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11},
	'B': {0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E},
	'C': {0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E},
	'D': {0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E},
	'E': {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F},
	'F': {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10},
	'G': {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F},
	'H': {0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11},
	'J': {0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C},
	'K': {0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11},
	'L': {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F},
	'M': {0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11},
	'N': {0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11},
	'P': {0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10},
	'Q': {0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D},
	'R': {0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11},
	'S': {0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E},
	'T': {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04},
	'U': {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
	'V': {0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04},
	'W': {0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11},
	'X': {0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11},
	'Y': {0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04},
	'Z': {0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F},
}

func renderCaptcha(code string) string {
	const w, h = 132, 44
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	fillRect(img, 0, 0, w, h, color.RGBA{R: 0xF2, G: 0xF5, B: 0xFA, A: 0xFF})

	for i := 0; i < 40; i++ {
		c := color.RGBA{R: uint8(mathrand.Intn(180)), G: uint8(mathrand.Intn(180)), B: uint8(mathrand.Intn(200)), A: 0xFF}
		fillRect(img, mathrand.Intn(w), mathrand.Intn(h), 2, 2, c)
	}
	for i := 0; i < 4; i++ {
		c := color.RGBA{R: uint8(mathrand.Intn(140)), G: uint8(mathrand.Intn(140)), B: uint8(mathrand.Intn(180)), A: 0xFF}
		drawLine(img, mathrand.Intn(w), mathrand.Intn(h), mathrand.Intn(w), mathrand.Intn(h), c)
	}
	for i := 0; i < len(code); i++ {
		c := color.RGBA{
			R: uint8(mathrand.Intn(90)),
			G: uint8(mathrand.Intn(70)),
			B: uint8(mathrand.Intn(130) + 60),
			A: 0xFF,
		}
		x := 14 + i*28
		y := 31 + mathrand.Intn(7) - 3
		drawGlyph(img, code[i], x, y, c)
	}

	buf := bytes.NewBuffer(make([]byte, 0, 8*1024))
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(buf, img); err != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func drawGlyph(img *image.RGBA, ch byte, x, y int, c color.RGBA) {
	rows, ok := captchaFont[ch]
	if !ok {
		return
	}
	const scaleX, scaleY = 3, 4
	slant := mathrand.Intn(3) - 1
	for r := 0; r < 7; r++ {
		shift := slant * (r - 3) / 3
		for col := 0; col < 5; col++ {
			if rows[r]&(1<<uint(4-col)) == 0 {
				continue
			}
			fillRect(img, x+col*scaleX+shift, y-27+r*scaleY, scaleX, scaleY, c)
		}
	}
}

func fillRect(img *image.RGBA, x, y, w, h int, c color.RGBA) {
	b := img.Bounds()
	for py := y; py < y+h; py++ {
		if py < b.Min.Y || py >= b.Max.Y {
			continue
		}
		for px := x; px < x+w; px++ {
			if px < b.Min.X || px >= b.Max.X {
				continue
			}
			img.SetRGBA(px, py, c)
		}
	}
}

func drawLine(img *image.RGBA, x0, y0, x1, y1 int, c color.RGBA) {
	dx := absInt(x1 - x0)
	dy := -absInt(y1 - y0)
	sx := 1
	if x0 > x1 {
		sx = -1
	}
	sy := 1
	if y0 > y1 {
		sy = -1
	}
	err := dx + dy
	for {
		fillRect(img, x0, y0, 1, 1, c)
		if x0 == x1 && y0 == y1 {
			return
		}
		e2 := 2 * err
		if e2 >= dy {
			err += dy
			x0 += sx
		}
		if e2 <= dx {
			err += dx
			y0 += sy
		}
	}
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
