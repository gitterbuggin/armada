// armada-imu-bridge — bridge the AYN Odin's SLPI IMU (via libssc) into a uinput
// IMU device that InputPlumber ingests (imu_generic capability map) and routes to
// the virtual Steam Deck controller's gyro/accel, so games get motion controls.
//
// The Odin's accel+gyro live behind the SLPI sensor DSP; libssc reads them over
// SSC/QMI/QRTR (GObject "measurement" signals). InputPlumber only consumes IMUs
// as evdev/IIO, not userspace data — so we emit an evdev uinput device with
// ABS_X/Y/Z (accel) + ABS_RX/RY/RZ (gyro), which imu_generic.yaml maps to
// Gamepad::Accelerometer / Gamepad::Gyro.
//
// Orientation and scale differ per chassis and want on-device tuning, so the
// mount matrix and full-scale ranges are read from the environment (no rebuild):
//   ARMADA_IMU_MOUNT   = "m00,m01,m02,m10,m11,m12,m20,m21,m22" (3x3, default identity)
//   ARMADA_IMU_ACCEL_FS = accel full-scale in m/s^2 mapped to the axis max (default 78.5 = 8g)
//   ARMADA_IMU_GYRO_FS  = gyro  full-scale in deg/s mapped to the axis max (default 2000)
// libssc reports accel in m/s^2 and gyro angular velocity in rad/s.

#include <libssc.h>
#include <glib.h>
#include <stdio.h>
#include <fcntl.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <math.h>
#include <sys/ioctl.h>
#include <linux/uinput.h>
#include <linux/input.h>

#define AXIS_MAX 32767
#define RAD2DEG  (180.0 / M_PI)

static int uinput_fd = -1;
static double mount[9] = {1,0,0, 0,1,0, 0,0,1};
static double accel_fs = 78.5;   // m/s^2 at AXIS_MAX
static double gyro_fs  = 2000.0; // deg/s  at AXIS_MAX

static void parse_env(void)
{
	const char *m = g_getenv("ARMADA_IMU_MOUNT");
	if (m) {
		double t[9];
		if (sscanf(m, "%lf,%lf,%lf,%lf,%lf,%lf,%lf,%lf,%lf",
			   &t[0],&t[1],&t[2],&t[3],&t[4],&t[5],&t[6],&t[7],&t[8]) == 9)
			memcpy(mount, t, sizeof(mount));
		else
			g_warning("ARMADA_IMU_MOUNT malformed; using identity");
	}
	const char *a = g_getenv("ARMADA_IMU_ACCEL_FS");
	if (a) accel_fs = g_ascii_strtod(a, NULL);
	const char *y = g_getenv("ARMADA_IMU_GYRO_FS");
	if (y) gyro_fs = g_ascii_strtod(y, NULL);
	if (accel_fs <= 0) accel_fs = 78.5;
	if (gyro_fs  <= 0) gyro_fs  = 2000.0;
}

static void apply_mount(double x, double y, double z, double out[3])
{
	out[0] = mount[0]*x + mount[1]*y + mount[2]*z;
	out[1] = mount[3]*x + mount[4]*y + mount[5]*z;
	out[2] = mount[6]*x + mount[7]*y + mount[8]*z;
}

static int clampi(double v)
{
	if (v >  AXIS_MAX) return  AXIS_MAX;
	if (v < -AXIS_MAX) return -AXIS_MAX;
	return (int)lrint(v);
}

static void emit(int code, int value)
{
	struct input_event ev = {0};
	ev.type = EV_ABS; ev.code = code; ev.value = value;
	if (write(uinput_fd, &ev, sizeof(ev)) < 0) g_warning("uinput write failed");
}

static void sync_report(void)
{
	struct input_event ev = {0};
	ev.type = EV_SYN; ev.code = SYN_REPORT; ev.value = 0;
	if (write(uinput_fd, &ev, sizeof(ev)) < 0) g_warning("uinput syn failed");
}

static void accel_cb(SSCSensorAccelerometer *s, gfloat x, gfloat y, gfloat z, gpointer u)
{
	(void)s; (void)u;
	double o[3];
	apply_mount(x, y, z, o);
	emit(ABS_X, clampi(o[0] / accel_fs * AXIS_MAX));
	emit(ABS_Y, clampi(o[1] / accel_fs * AXIS_MAX));
	emit(ABS_Z, clampi(o[2] / accel_fs * AXIS_MAX));
	sync_report();
}

static void gyro_cb(SSCSensorGyroscope *s, gfloat vx, gfloat vy, gfloat vz, gpointer u)
{
	(void)s; (void)u;
	double o[3];
	apply_mount(vx * RAD2DEG, vy * RAD2DEG, vz * RAD2DEG, o);  // rad/s -> deg/s
	emit(ABS_RX, clampi(o[0] / gyro_fs * AXIS_MAX));
	emit(ABS_RY, clampi(o[1] / gyro_fs * AXIS_MAX));
	emit(ABS_RZ, clampi(o[2] / gyro_fs * AXIS_MAX));
	sync_report();
}

static int setup_uinput(void)
{
	int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
	if (fd < 0) { g_printerr("open /dev/uinput: %m\n"); return -1; }

	ioctl(fd, UI_SET_EVBIT, EV_ABS);
	const int axes[] = { ABS_X, ABS_Y, ABS_Z, ABS_RX, ABS_RY, ABS_RZ };
	for (unsigned i = 0; i < G_N_ELEMENTS(axes); i++) {
		ioctl(fd, UI_SET_ABSBIT, axes[i]);
		struct uinput_abs_setup abs = {0};
		abs.code = axes[i];
		abs.absinfo.minimum = -AXIS_MAX;
		abs.absinfo.maximum =  AXIS_MAX;
		ioctl(fd, UI_ABS_SETUP, &abs);
	}

	struct uinput_setup us = {0};
	us.id.bustype = BUS_VIRTUAL;
	us.id.vendor  = 0x0000;
	us.id.product = 0x0001;
	g_strlcpy(us.name, "Armada Odin IMU", sizeof(us.name));
	if (ioctl(fd, UI_DEV_SETUP, &us) < 0) { g_printerr("UI_DEV_SETUP: %m\n"); close(fd); return -1; }
	if (ioctl(fd, UI_DEV_CREATE) < 0)     { g_printerr("UI_DEV_CREATE: %m\n"); close(fd); return -1; }
	return fd;
}

int main(void)
{
	GError *err = NULL;
	parse_env();

	uinput_fd = setup_uinput();
	if (uinput_fd < 0) return 1;

	SSCSensorAccelerometer *accel = ssc_sensor_accelerometer_new_sync(NULL, &err);
	if (!accel) { g_printerr("accel new: %s\n", err ? err->message : "?"); return 1; }
	g_signal_connect(accel, "measurement", G_CALLBACK(accel_cb), NULL);
	if (!ssc_sensor_accelerometer_open_sync(accel, NULL, &err))
		g_printerr("accel open: %s\n", err ? err->message : "?");

	SSCSensorGyroscope *gyro = ssc_sensor_gyroscope_new_sync(NULL, &err);
	if (!gyro) { g_printerr("gyro new: %s\n", err ? err->message : "?"); return 1; }
	g_signal_connect(gyro, "measurement", G_CALLBACK(gyro_cb), NULL);
	if (!ssc_sensor_gyroscope_open_sync(gyro, NULL, &err))
		g_printerr("gyro open: %s\n", err ? err->message : "?");

	g_info("armada-imu-bridge: streaming accel+gyro to uinput 'Armada Odin IMU'");
	GMainLoop *loop = g_main_loop_new(NULL, FALSE);
	g_main_loop_run(loop);
	return 0;
}
